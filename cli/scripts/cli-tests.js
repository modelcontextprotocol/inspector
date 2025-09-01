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
console.log(`${colors.BLUE}- Resource-related options (--uri)${colors.NC}`);
console.log(
  `${colors.BLUE}- Prompt-related options (--prompt-name, --prompt-args)${colors.NC}`,
);
console.log(`${colors.BLUE}- Logging options (--log-level)${colors.NC}`);
console.log(
  `${colors.BLUE}- Transport types (--transport http/sse/stdio)${colors.NC}`,
);
console.log(
  `${colors.BLUE}- Transport inference from URL suffixes (/mcp, /sse)${colors.NC}`,
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
const OUTPUT_DIR = path.join(SCRIPTS_DIR, "test-output");
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Create a temporary directory for test files
const TEMP_DIR = path.join(os.tmpdir(), "mcp-inspector-tests");
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

// Create config files with different transport types for testing
const sseConfigPath = path.join(TEMP_DIR, "sse-config.json");
fs.writeFileSync(
  sseConfigPath,
  JSON.stringify(
    {
      mcpServers: {
        "test-sse": {
          type: "sse",
          url: "http://localhost:3000/sse",
          note: "Test SSE server",
        },
      },
    },
    null,
    2,
  ),
);

const httpConfigPath = path.join(TEMP_DIR, "http-config.json");
fs.writeFileSync(
  httpConfigPath,
  JSON.stringify(
    {
      mcpServers: {
        "test-http": {
          type: "streamable-http",
          url: "http://localhost:3000/mcp",
          note: "Test HTTP server",
        },
      },
    },
    null,
    2,
  ),
);

const stdioConfigPath = path.join(TEMP_DIR, "stdio-config.json");
fs.writeFileSync(
  stdioConfigPath,
  JSON.stringify(
    {
      mcpServers: {
        "test-stdio": {
          type: "stdio",
          command: "npx",
          args: ["@modelcontextprotocol/server-everything"],
          env: {
            TEST_ENV: "test-value",
          },
        },
      },
    },
    null,
    2,
  ),
);

// Config without type field (backward compatibility)
const legacyConfigPath = path.join(TEMP_DIR, "legacy-config.json");
fs.writeFileSync(
  legacyConfigPath,
  JSON.stringify(
    {
      mcpServers: {
        "test-legacy": {
          command: "npx",
          args: ["@modelcontextprotocol/server-everything"],
          env: {
            LEGACY_ENV: "legacy-value",
          },
        },
      },
    },
    null,
    2,
  ),
);

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

  console.log(
    `\n${colors.YELLOW}=== Running Config Transport Type Tests ===${colors.NC}`,
  );

  // Test 25: Config with stdio transport type
  await runBasicTest(
    "config_stdio_type",
    "--config",
    stdioConfigPath,
    "--server",
    "test-stdio",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 26: Config with SSE transport type (CLI mode) - expects connection error
  await runErrorTest(
    "config_sse_type_cli",
    "--config",
    sseConfigPath,
    "--server",
    "test-sse",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 27: Config with streamable-http transport type (CLI mode) - expects connection error
  await runErrorTest(
    "config_http_type_cli",
    "--config",
    httpConfigPath,
    "--server",
    "test-http",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 28: Legacy config without type field (backward compatibility)
  await runBasicTest(
    "config_legacy_no_type",
    "--config",
    legacyConfigPath,
    "--server",
    "test-legacy",
    "--cli",
    "--method",
    "tools/list",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Default Server Tests ===${colors.NC}`,
  );

  // Create config with single server for auto-selection
  const singleServerConfigPath = path.join(
    TEMP_DIR,
    "single-server-config.json",
  );
  fs.writeFileSync(
    singleServerConfigPath,
    JSON.stringify(
      {
        mcpServers: {
          "only-server": {
            command: "npx",
            args: ["@modelcontextprotocol/server-everything"],
          },
        },
      },
      null,
      2,
    ),
  );

  // Create config with default-server
  const defaultServerConfigPath = path.join(
    TEMP_DIR,
    "default-server-config.json",
  );
  fs.writeFileSync(
    defaultServerConfigPath,
    JSON.stringify(
      {
        mcpServers: {
          "default-server": {
            command: "npx",
            args: ["@modelcontextprotocol/server-everything"],
          },
          "other-server": {
            command: "node",
            args: ["other.js"],
          },
        },
      },
      null,
      2,
    ),
  );

  // Create config with multiple servers (no default)
  const multiServerConfigPath = path.join(TEMP_DIR, "multi-server-config.json");
  fs.writeFileSync(
    multiServerConfigPath,
    JSON.stringify(
      {
        mcpServers: {
          server1: {
            command: "npx",
            args: ["@modelcontextprotocol/server-everything"],
          },
          server2: {
            command: "node",
            args: ["other.js"],
          },
        },
      },
      null,
      2,
    ),
  );

  // Test 29: Config with single server auto-selection
  await runBasicTest(
    "single_server_auto_select",
    "--config",
    singleServerConfigPath,
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 30: Config with default-server should now require explicit selection (multiple servers)
  await runErrorTest(
    "default_server_requires_explicit_selection",
    "--config",
    defaultServerConfigPath,
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 31: Config with multiple servers and no default (should fail)
  await runErrorTest(
    "multi_server_no_default",
    "--config",
    multiServerConfigPath,
    "--cli",
    "--method",
    "tools/list",
  );

  console.log(
    `\n${colors.YELLOW}=== Running HTTP Transport Tests ===${colors.NC}`,
  );

  console.log(
    `${colors.BLUE}Starting server-everything in streamableHttp mode.${colors.NC}`,
  );
  const httpServer = spawn(
    "npx",
    ["@modelcontextprotocol/server-everything", "streamableHttp"],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  runningServers.push(httpServer);

  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Test 32: HTTP transport inferred from URL ending with /mcp
  await runBasicTest(
    "http_transport_inferred",
    "http://127.0.0.1:3001/mcp",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 33: HTTP transport with explicit --transport http flag
  await runBasicTest(
    "http_transport_with_explicit_flag",
    "http://127.0.0.1:3001/mcp",
    "--transport",
    "http",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 34: HTTP transport with suffix and --transport http flag
  await runBasicTest(
    "http_transport_with_explicit_flag_and_suffix",
    "http://127.0.0.1:3001/mcp",
    "--transport",
    "http",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 35: SSE transport given to HTTP server (should fail)
  await runErrorTest(
    "sse_transport_given_to_http_server",
    "http://127.0.0.1:3001",
    "--transport",
    "sse",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 36: HTTP transport without URL (should fail)
  await runErrorTest(
    "http_transport_without_url",
    "--transport",
    "http",
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 37: SSE transport without URL (should fail)
  await runErrorTest(
    "sse_transport_without_url",
    "--transport",
    "sse",
    "--cli",
    "--method",
    "tools/list",
  );

  // Kill HTTP server
  try {
    process.kill(-httpServer.pid);
    console.log(
      `${colors.BLUE}HTTP server killed, waiting for port to be released...${colors.NC}`,
    );
  } catch (e) {
    console.log(
      `${colors.RED}Error killing HTTP server: ${e.message}${colors.NC}`,
    );
  }

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
