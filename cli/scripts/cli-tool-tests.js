#!/usr/bin/env node

// Colors for output
const colors = {
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  RED: "\x1b[31m",
  BLUE: "\x1b[34m",
  ORANGE: "\x1b[33m",
  NC: "\x1b[0m", // No Color
};

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import os from "os";
import { fileURLToPath } from "url";

// Get directory paths with ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track test results
let PASSED_TESTS = 0;
let FAILED_TESTS = 0;
let SKIPPED_TESTS = 0;
let TOTAL_TESTS = 0;

console.log(`${colors.YELLOW}=== MCP Inspector CLI Tool Tests ===${colors.NC}`);
console.log(
  `${colors.BLUE}This script tests the MCP Inspector CLI's tool-related functionality:${colors.NC}`,
);
console.log(`${colors.BLUE}- Tool discovery and listing${colors.NC}`);
console.log(
  `${colors.BLUE}- JSON argument parsing (strings, numbers, booleans, objects, arrays)${colors.NC}`,
);
console.log(`${colors.BLUE}- Tool schema validation${colors.NC}`);
console.log(
  `${colors.BLUE}- Tool execution with various argument types${colors.NC}`,
);
console.log(
  `${colors.BLUE}- Error handling for invalid tools and arguments${colors.NC}`,
);
console.log(`\n`);

// Get directory paths
const SCRIPTS_DIR = __dirname;
const PROJECT_ROOT = path.join(SCRIPTS_DIR, "../../");
const BUILD_DIR = path.resolve(SCRIPTS_DIR, "../build");

// Define the test server command using npx
const TEST_CMD = "npx";
const TEST_ARGS = ["@modelcontextprotocol/server-everything"];

// Create output directory for test results
const OUTPUT_DIR = path.join(SCRIPTS_DIR, "tool-test-output");
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Create a temporary directory for test files
const TEMP_DIR = path.join(os.tmpdir(), "mcp-inspector-tool-tests");
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Track servers for cleanup
let runningServers = [];

process.on("exit", () => {
  try {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch (err) {
    console.error(
      `${colors.RED}Failed to remove temp directory: ${err.message}${colors.NC}`,
    );
  }

  runningServers.forEach((server) => {
    try {
      process.kill(-server.pid);
    } catch (e) {}
  });
});

process.on("SIGINT", () => {
  runningServers.forEach((server) => {
    try {
      process.kill(-server.pid);
    } catch (e) {}
  });
  process.exit(1);
});

// Function to run a basic test
async function runBasicTest(testName, ...args) {
  const outputFile = path.join(
    OUTPUT_DIR,
    `${testName.replace(/\//g, "_")}.log`,
  );

  console.log(`\n${colors.YELLOW}Testing: ${testName}${colors.NC}`);
  TOTAL_TESTS++;

  // Run the command and capture output
  console.log(
    `${colors.BLUE}Command: node ${BUILD_DIR}/cli.js ${args.join(" ")}${colors.NC}`,
  );

  try {
    // Create a write stream for the output file
    const outputStream = fs.createWriteStream(outputFile);

    // Spawn the process
    return new Promise((resolve) => {
      const child = spawn("node", [path.join(BUILD_DIR, "cli.js"), ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        console.log(`${colors.YELLOW}Test timed out: ${testName}${colors.NC}`);
        child.kill();
      }, 10000);

      // Pipe stdout and stderr to the output file
      child.stdout.pipe(outputStream);
      child.stderr.pipe(outputStream);

      // Also capture output for display
      let output = "";
      child.stdout.on("data", (data) => {
        output += data.toString();
      });
      child.stderr.on("data", (data) => {
        output += data.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        outputStream.end();

        if (code === 0) {
          console.log(`${colors.GREEN}✓ Test passed: ${testName}${colors.NC}`);
          console.log(`${colors.BLUE}First few lines of output:${colors.NC}`);
          const firstFewLines = output
            .split("\n")
            .slice(0, 5)
            .map((line) => `  ${line}`)
            .join("\n");
          console.log(firstFewLines);
          PASSED_TESTS++;
          resolve(true);
        } else {
          console.log(`${colors.RED}✗ Test failed: ${testName}${colors.NC}`);
          console.log(`${colors.RED}Error output:${colors.NC}`);
          console.log(
            output
              .split("\n")
              .map((line) => `  ${line}`)
              .join("\n"),
          );
          FAILED_TESTS++;

          // Stop after any error is encountered
          console.log(
            `${colors.YELLOW}Stopping tests due to error. Please validate and fix before continuing.${colors.NC}`,
          );
          process.exit(1);
        }
      });
    });
  } catch (error) {
    console.error(
      `${colors.RED}Error running test: ${error.message}${colors.NC}`,
    );
    FAILED_TESTS++;
    process.exit(1);
  }
}

// Function to run an error test (expected to fail)
async function runErrorTest(testName, ...args) {
  const outputFile = path.join(
    OUTPUT_DIR,
    `${testName.replace(/\//g, "_")}.log`,
  );

  console.log(`\n${colors.YELLOW}Testing error case: ${testName}${colors.NC}`);
  TOTAL_TESTS++;

  // Run the command and capture output
  console.log(
    `${colors.BLUE}Command: node ${BUILD_DIR}/cli.js ${args.join(" ")}${colors.NC}`,
  );

  try {
    // Create a write stream for the output file
    const outputStream = fs.createWriteStream(outputFile);

    // Spawn the process
    return new Promise((resolve) => {
      const child = spawn("node", [path.join(BUILD_DIR, "cli.js"), ...args], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        console.log(
          `${colors.YELLOW}Error test timed out: ${testName}${colors.NC}`,
        );
        child.kill();
      }, 10000);

      // Pipe stdout and stderr to the output file
      child.stdout.pipe(outputStream);
      child.stderr.pipe(outputStream);

      // Also capture output for display
      let output = "";
      child.stdout.on("data", (data) => {
        output += data.toString();
      });
      child.stderr.on("data", (data) => {
        output += data.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        outputStream.end();

        // For error tests, we expect a non-zero exit code
        if (code !== 0) {
          console.log(
            `${colors.GREEN}✓ Error test passed: ${testName}${colors.NC}`,
          );
          console.log(`${colors.BLUE}Error output (expected):${colors.NC}`);
          const firstFewLines = output
            .split("\n")
            .slice(0, 5)
            .map((line) => `  ${line}`)
            .join("\n");
          console.log(firstFewLines);
          PASSED_TESTS++;
          resolve(true);
        } else {
          console.log(
            `${colors.RED}✗ Error test failed: ${testName} (expected error but got success)${colors.NC}`,
          );
          console.log(`${colors.RED}Output:${colors.NC}`);
          console.log(
            output
              .split("\n")
              .map((line) => `  ${line}`)
              .join("\n"),
          );
          FAILED_TESTS++;

          // Stop after any error is encountered
          console.log(
            `${colors.YELLOW}Stopping tests due to error. Please validate and fix before continuing.${colors.NC}`,
          );
          process.exit(1);
        }
      });
    });
  } catch (error) {
    console.error(
      `${colors.RED}Error running test: ${error.message}${colors.NC}`,
    );
    FAILED_TESTS++;
    process.exit(1);
  }
}

// Run all tests
async function runTests() {
  console.log(
    `\n${colors.YELLOW}=== Running Tool Discovery Tests ===${colors.NC}`,
  );

  // Test 1: List available tools
  await runBasicTest(
    "tool_discovery_list",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
  );

  console.log(
    `\n${colors.YELLOW}=== Running JSON Argument Parsing Tests ===${colors.NC}`,
  );

  // Test 2: String arguments (backward compatibility)
  await runBasicTest(
    "json_args_string",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=hello world",
  );

  // Test 3: Number arguments
  await runBasicTest(
    "json_args_number_integer",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "add",
    "--tool-arg",
    "a=42",
    "b=58",
  );

  // Test 4: Number arguments with decimals (using add tool with decimal numbers)
  await runBasicTest(
    "json_args_number_decimal",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "add",
    "--tool-arg",
    "a=19.99",
    "b=20.01",
  );

  // Test 5: Boolean arguments - true
  await runBasicTest(
    "json_args_boolean_true",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "annotatedMessage",
    "--tool-arg",
    "messageType=success",
    "includeImage=true",
  );

  // Test 6: Boolean arguments - false
  await runBasicTest(
    "json_args_boolean_false",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "annotatedMessage",
    "--tool-arg",
    "messageType=error",
    "includeImage=false",
  );

  // Test 7: Null arguments (using echo with string "null")
  await runBasicTest(
    "json_args_null",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    'message="null"',
  );

  // Test 14: Multiple arguments with mixed types (using add tool)
  await runBasicTest(
    "json_args_multiple_mixed",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "add",
    "--tool-arg",
    "a=42.5",
    "b=57.5",
  );

  console.log(
    `\n${colors.YELLOW}=== Running JSON Parsing Edge Cases ===${colors.NC}`,
  );

  // Test 15: Invalid JSON should fall back to string
  await runBasicTest(
    "json_args_invalid_fallback",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message={invalid json}",
  );

  // Test 16: Empty string value
  await runBasicTest(
    "json_args_empty_value",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    'message=""',
  );

  // Test 17: Special characters in strings
  await runBasicTest(
    "json_args_special_chars",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    'message="C:\\\\Users\\\\test"',
  );

  // Test 18: Unicode characters
  await runBasicTest(
    "json_args_unicode",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    'message="🚀🎉✨"',
  );

  // Test 19: Arguments with equals signs in values
  await runBasicTest(
    "json_args_equals_in_value",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=2+2=4",
  );

  // Test 20: Base64-like strings
  await runBasicTest(
    "json_args_base64_like",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0=",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Tool Error Handling Tests ===${colors.NC}`,
  );

  // Test 21: Non-existent tool
  await runErrorTest(
    "tool_error_nonexistent",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "nonexistent_tool",
    "--tool-arg",
    "message=test",
  );

  // Test 22: Missing tool name
  await runErrorTest(
    "tool_error_missing_name",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-arg",
    "message=test",
  );

  // Test 23: Invalid tool argument format
  await runErrorTest(
    "tool_error_invalid_arg_format",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "invalid_format_no_equals",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Prompt JSON Argument Tests ===${colors.NC}`,
  );

  // Test 24: Prompt with JSON arguments
  await runBasicTest(
    "prompt_json_args_mixed",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "prompts/get",
    "--prompt-name",
    "complex_prompt",
    "--prompt-args",
    "temperature=0.7",
    'style="concise"',
    'options={"format":"json","max_tokens":100}',
  );

  // Test 25: Prompt with simple arguments
  await runBasicTest(
    "prompt_json_args_simple",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "prompts/get",
    "--prompt-name",
    "simple_prompt",
    "--prompt-args",
    "name=test",
    "count=5",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Backward Compatibility Tests ===${colors.NC}`,
  );

  // Test 26: Ensure existing string-only usage still works
  await runBasicTest(
    "backward_compatibility_strings",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=hello",
  );

  // Test 27: Multiple string arguments (existing pattern) - using add tool
  await runBasicTest(
    "backward_compatibility_multiple_strings",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "add",
    "--tool-arg",
    "a=10",
    "b=20",
  );

  // Print test summary
  console.log(`\n${colors.YELLOW}=== Test Summary ===${colors.NC}`);
  console.log(`${colors.GREEN}Passed: ${PASSED_TESTS}${colors.NC}`);
  console.log(`${colors.RED}Failed: ${FAILED_TESTS}${colors.NC}`);
  console.log(`${colors.ORANGE}Skipped: ${SKIPPED_TESTS}${colors.NC}`);
  console.log(`Total: ${TOTAL_TESTS}`);
  console.log(
    `${colors.BLUE}Detailed logs saved to: ${OUTPUT_DIR}${colors.NC}`,
  );

  console.log(`\n${colors.GREEN}All tool tests completed!${colors.NC}`);
}

// Run all tests
runTests().catch((error) => {
  console.error(
    `${colors.RED}Tests failed with error: ${error.message}${colors.NC}`,
  );
  process.exit(1);
});
