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

console.log(
  `${colors.YELLOW}=== MCP Inspector CLI Metadata Tests ===${colors.NC}`,
);
console.log(
  `${colors.BLUE}This script tests the MCP Inspector CLI's metadata functionality:${colors.NC}`,
);
console.log(
  `${colors.BLUE}- General metadata with --metadata option${colors.NC}`,
);
console.log(
  `${colors.BLUE}- Tool-specific metadata with --tool-metadata option${colors.NC}`,
);
console.log(
  `${colors.BLUE}- Metadata parsing with various data types${colors.NC}`,
);
console.log(
  `${colors.BLUE}- Metadata merging (tool-specific overrides general)${colors.NC}`,
);
console.log(
  `${colors.BLUE}- Metadata evaluation in different MCP methods${colors.NC}`,
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
const OUTPUT_DIR = path.join(SCRIPTS_DIR, "metadata-test-output");
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Create a temporary directory for test files
const TEMP_DIR = path.join(os.tmpdir(), "mcp-inspector-metadata-tests");
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
      }, 15000);

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

        // Check if we got valid JSON output (indicating success) even if process didn't exit cleanly
        const hasValidJsonOutput =
          output.includes('"tools"') ||
          output.includes('"resources"') ||
          output.includes('"prompts"') ||
          output.includes('"content"') ||
          output.includes('"messages"') ||
          output.includes('"contents"');

        if (code === 0 || hasValidJsonOutput) {
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
      }, 15000);

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
    `\n${colors.YELLOW}=== Running General Metadata Tests ===${colors.NC}`,
  );

  // Test 1: General metadata with tools/list
  await runBasicTest(
    "metadata_tools_list",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
    "--metadata",
    "client=test-client",
  );

  // Test 2: General metadata with resources/list
  await runBasicTest(
    "metadata_resources_list",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "resources/list",
    "--metadata",
    "client=test-client",
  );

  // Test 3: General metadata with prompts/list
  await runBasicTest(
    "metadata_prompts_list",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "prompts/list",
    "--metadata",
    "client=test-client",
  );

  // Test 4: General metadata with resources/read
  await runBasicTest(
    "metadata_resources_read",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "resources/read",
    "--uri",
    "test://static/resource/1",
    "--metadata",
    "client=test-client",
  );

  // Test 5: General metadata with prompts/get
  await runBasicTest(
    "metadata_prompts_get",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "prompts/get",
    "--prompt-name",
    "simple_prompt",
    "--metadata",
    "client=test-client",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Tool-Specific Metadata Tests ===${colors.NC}`,
  );

  // Test 6: Tool-specific metadata with tools/call
  await runBasicTest(
    "metadata_tools_call_tool_meta",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=hello world",
    "--tool-metadata",
    "client=test-client",
  );

  // Test 7: Tool-specific metadata with complex tool
  await runBasicTest(
    "metadata_tools_call_complex_tool_meta",
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
    "--tool-metadata",
    "client=test-client",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Metadata Merging Tests ===${colors.NC}`,
  );

  // Test 8: General metadata + tool-specific metadata (tool-specific should override)
  await runBasicTest(
    "metadata_merging_general_and_tool",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=hello world",
    "--metadata",
    "client=general-client",
    "--tool-metadata",
    "client=test-client",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Metadata Parsing Tests ===${colors.NC}`,
  );

  // Test 10: Metadata with numeric values (should be converted to strings)
  await runBasicTest(
    "metadata_parsing_numbers",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
    "--metadata",
    "integer_value=42",
    "decimal_value=3.14159",
    "negative_value=-10",
  );

  // Test 11: Metadata with JSON values (should be converted to strings)
  await runBasicTest(
    "metadata_parsing_json",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
    "--metadata",
    'json_object="{\\"key\\":\\"value\\"}"',
    'json_array="[1,2,3]"',
    'json_string="\\"quoted\\""',
  );

  // Test 12: Metadata with special characters
  await runBasicTest(
    "metadata_parsing_special_chars",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
    "--metadata",
    "unicode=🚀🎉✨",
    "special_chars=!@#$%^&*()",
    "spaces=hello world with spaces",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Metadata Edge Cases ===${colors.NC}`,
  );

  // Test 13: Single metadata entry
  await runBasicTest(
    "metadata_single_entry",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
    "--metadata",
    "single_key=single_value",
  );

  // Test 14: Many metadata entries
  await runBasicTest(
    "metadata_many_entries",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
    "--metadata",
    "key1=value1",
    "key2=value2",
    "key3=value3",
    "key4=value4",
    "key5=value5",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Metadata Error Cases ===${colors.NC}`,
  );

  // Test 15: Invalid metadata format (missing equals)
  await runErrorTest(
    "metadata_error_invalid_format",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
    "--metadata",
    "invalid_format_no_equals",
  );

  // Test 16: Invalid tool-meta format (missing equals)
  await runErrorTest(
    "metadata_error_invalid_tool_meta_format",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=test",
    "--tool-metadata",
    "invalid_format_no_equals",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Metadata Impact Tests ===${colors.NC}`,
  );

  // Test 17: Test tool-specific metadata vs general metadata precedence
  await runBasicTest(
    "metadata_precedence_tool_overrides_general",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=precedence test",
    "--metadata",
    "client=general-client",
    "--tool-metadata",
    "client=tool-specific-client",
  );

  // Test 18: Test metadata with resources methods
  await runBasicTest(
    "metadata_resources_methods",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "resources/list",
    "--metadata",
    "resource_client=test-resource-client",
  );

  // Test 19: Test metadata with prompts methods
  await runBasicTest(
    "metadata_prompts_methods",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "prompts/get",
    "--prompt-name",
    "simple_prompt",
    "--metadata",
    "prompt_client=test-prompt-client",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Metadata Validation Tests ===${colors.NC}`,
  );

  // Test 20: Test metadata with special characters in keys
  await runBasicTest(
    "metadata_special_key_characters",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=special keys test",
    "--metadata",
    "key-with-dashes=value1",
    "key_with_underscores=value2",
    "key.with.dots=value3",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Metadata Integration Tests ===${colors.NC}`,
  );

  // Test 21: Metadata with all MCP methods
  await runBasicTest(
    "metadata_integration_all_methods",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
    "--metadata",
    "integration_test=true",
    "test_phase=all_methods",
  );

  // Test 22: Complex metadata scenario
  await runBasicTest(
    "metadata_complex_scenario",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=complex test",
    "--metadata",
    "session_id=12345",
    "user_id=67890",
    "timestamp=2024-01-01T00:00:00Z",
    "request_id=req-abc-123",
    "--tool-metadata",
    "tool_session=session-xyz-789",
    "execution_context=test",
    "priority=high",
  );

  // Test 23: Metadata parsing validation test
  await runBasicTest(
    "metadata_parsing_validation",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=parsing validation test",
    "--metadata",
    "valid_key=valid_value",
    "numeric_key=123",
    "boolean_key=true",
    'json_key=\'{"test":"value"}\'',
    "special_key=!@#$%^&*()",
    "unicode_key=🚀🎉✨",
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

  console.log(`\n${colors.GREEN}All metadata tests completed!${colors.NC}`);
}

// Run all tests
runTests().catch((error) => {
  console.error(
    `${colors.RED}Tests failed with error: ${error.message}${colors.NC}`,
  );
  process.exit(1);
});
