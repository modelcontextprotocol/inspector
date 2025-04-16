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
import { execSync, spawn } from "child_process";
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
  `${colors.YELLOW}=== MCP Inspector CLI Test Script ===${colors.NC}`,
);
console.log(
  `${colors.BLUE}This script tests the MCP Inspector CLI's ability to handle various command line options:${colors.NC}`,
);
console.log(`${colors.BLUE}- Basic CLI mode${colors.NC}`);
console.log(`${colors.BLUE}- Environment variables (-e)${colors.NC}`);
console.log(`${colors.BLUE}- Config file (--config)${colors.NC}`);
console.log(`${colors.BLUE}- Server selection (--server)${colors.NC}`);
console.log(`${colors.BLUE}- Method selection (--method)${colors.NC}`);
console.log(
  `${colors.BLUE}- Tool-related options (--tool-name, --tool-arg)${colors.NC}`,
);
console.log(`${colors.BLUE}- Resource-related options (--uri)${colors.NC}`);
console.log(
  `${colors.BLUE}- Prompt-related options (--prompt-name, --prompt-args)${colors.NC}`,
);
console.log(`${colors.BLUE}- Logging options (--log-level)${colors.NC}\n`);

// Get directory paths
const SCRIPTS_DIR = __dirname;
const PROJECT_ROOT = path.join(SCRIPTS_DIR, "../../");
const BUILD_DIR = path.resolve(SCRIPTS_DIR, "../build");

// Define the test server command using npx
const TEST_CMD = "npx";
const TEST_ARGS = ["@modelcontextprotocol/server-everything"];

// Create output directory for test results
const OUTPUT_DIR = path.join(SCRIPTS_DIR, "test-output");
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Create a temporary directory for test files
const TEMP_DIR = fs.mkdirSync(path.join(os.tmpdir(), "mcp-inspector-tests"), {
  recursive: true,
});

process.on("exit", () => {
  try {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch (err) {
    console.error(
      `${colors.RED}Failed to remove temp directory: ${err.message}${colors.NC}`,
    );
  }
});

// Use the existing sample config file
console.log(
  `${colors.BLUE}Using existing sample config file: ${PROJECT_ROOT}/sample-config.json${colors.NC}`,
);
try {
  const sampleConfig = fs.readFileSync(
    path.join(PROJECT_ROOT, "sample-config.json"),
    "utf8",
  );
  console.log(sampleConfig);
} catch (error) {
  console.error(
    `${colors.RED}Error reading sample config: ${error.message}${colors.NC}`,
  );
}

// Create an invalid config file for testing
const invalidConfigPath = path.join(TEMP_DIR, "invalid-config.json");
fs.writeFileSync(invalidConfigPath, '{\n  "mcpServers": {\n    "invalid": {');

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
    `\n${colors.YELLOW}=== Running Basic CLI Mode Tests ===${colors.NC}`,
  );

  // Test 1: Basic CLI mode with method
  await runBasicTest(
    "basic_cli_mode",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 2: CLI mode with non-existent method (should fail)
  await runErrorTest(
    "nonexistent_method",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "nonexistent/method",
  );

  // Test 3: CLI mode without method (should fail)
  await runErrorTest("missing_method", TEST_CMD, ...TEST_ARGS, "--cli");

  console.log(
    `\n${colors.YELLOW}=== Running Environment Variable Tests ===${colors.NC}`,
  );

  // Test 4: CLI mode with environment variables
  await runBasicTest(
    "env_variables",
    TEST_CMD,
    ...TEST_ARGS,
    "-e",
    "KEY1=value1",
    "-e",
    "KEY2=value2",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 5: CLI mode with invalid environment variable format (should fail)
  await runErrorTest(
    "invalid_env_format",
    TEST_CMD,
    ...TEST_ARGS,
    "-e",
    "INVALID_FORMAT",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 5b: CLI mode with environment variable containing equals sign in value
  await runBasicTest(
    "env_variable_with_equals",
    TEST_CMD,
    ...TEST_ARGS,
    "-e",
    "API_KEY=abc123=xyz789==",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 5c: CLI mode with environment variable containing base64-encoded value
  await runBasicTest(
    "env_variable_with_base64",
    TEST_CMD,
    ...TEST_ARGS,
    "-e",
    "JWT_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0=",
    "--cli",
    "--method",
    "tools/list",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Config File Tests ===${colors.NC}`,
  );

  // Test 6: Using config file with CLI mode
  await runBasicTest(
    "config_file",
    "--config",
    path.join(PROJECT_ROOT, "sample-config.json"),
    "--server",
    "everything",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 7: Using config file without server name (should fail)
  await runErrorTest(
    "config_without_server",
    "--config",
    path.join(PROJECT_ROOT, "sample-config.json"),
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 8: Using server name without config file (should fail)
  await runErrorTest(
    "server_without_config",
    "--server",
    "everything",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 9: Using non-existent config file (should fail)
  await runErrorTest(
    "nonexistent_config",
    "--config",
    "./nonexistent-config.json",
    "--server",
    "everything",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 10: Using invalid config file format (should fail)
  await runErrorTest(
    "invalid_config",
    "--config",
    invalidConfigPath,
    "--server",
    "everything",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 11: Using config file with non-existent server (should fail)
  await runErrorTest(
    "nonexistent_server",
    "--config",
    path.join(PROJECT_ROOT, "sample-config.json"),
    "--server",
    "nonexistent",
    "--cli",
    "--method",
    "tools/list",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Tool-Related Tests ===${colors.NC}`,
  );

  // Test 12: CLI mode with tool call
  await runBasicTest(
    "tool_call",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=Hello",
  );

  // Test 13: CLI mode with tool call but missing tool name (should fail)
  await runErrorTest(
    "missing_tool_name",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-arg",
    "message=Hello",
  );

  // Test 14: CLI mode with tool call but invalid tool args format (should fail)
  await runErrorTest(
    "invalid_tool_args",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "invalid_format",
  );

  // Test 15: CLI mode with multiple tool args
  await runBasicTest(
    "multiple_tool_args",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "add",
    "--tool-arg",
    "a=1",
    "b=2",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Resource-Related Tests ===${colors.NC}`,
  );

  // Test 16: CLI mode with resource read
  await runBasicTest(
    "resource_read",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "resources/read",
    "--uri",
    "test://static/resource/1",
  );

  // Test 17: CLI mode with resource read but missing URI (should fail)
  await runErrorTest(
    "missing_uri",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "resources/read",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Prompt-Related Tests ===${colors.NC}`,
  );

  // Test 18: CLI mode with prompt get
  await runBasicTest(
    "prompt_get",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "prompts/get",
    "--prompt-name",
    "simple_prompt",
  );

  // Test 19: CLI mode with prompt get and args
  await runBasicTest(
    "prompt_get_with_args",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "prompts/get",
    "--prompt-name",
    "complex_prompt",
    "--prompt-args",
    "temperature=0.7",
    "style=concise",
  );

  // Test 20: CLI mode with prompt get but missing prompt name (should fail)
  await runErrorTest(
    "missing_prompt_name",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "prompts/get",
  );

  console.log(`\n${colors.YELLOW}=== Running Logging Tests ===${colors.NC}`);

  // Test 21: CLI mode with log level
  await runBasicTest(
    "log_level",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "logging/setLevel",
    "--log-level",
    "debug",
  );

  // Test 22: CLI mode with invalid log level (should fail)
  await runErrorTest(
    "invalid_log_level",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "logging/setLevel",
    "--log-level",
    "invalid",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Combined Option Tests ===${colors.NC}`,
  );

  // Note about the combined options issue
  console.log(
    `${colors.BLUE}Testing combined options with environment variables and config file.${colors.NC}`,
  );

  // Test 23: CLI mode with config file, environment variables, and tool call
  await runBasicTest(
    "combined_options",
    "--config",
    path.join(PROJECT_ROOT, "sample-config.json"),
    "--server",
    "everything",
    "-e",
    "CLI_ENV_VAR=cli_value",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 24: CLI mode with all possible options (that make sense together)
  await runBasicTest(
    "all_options",
    "--config",
    path.join(PROJECT_ROOT, "sample-config.json"),
    "--server",
    "everything",
    "-e",
    "CLI_ENV_VAR=cli_value",
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=Hello",
    "--log-level",
    "debug",
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

  console.log(`\n${colors.GREEN}All tests completed!${colors.NC}`);
}

// Run all tests
runTests().catch((error) => {
  console.error(
    `${colors.RED}Tests failed with error: ${error.message}${colors.NC}`,
  );
  process.exit(1);
});
