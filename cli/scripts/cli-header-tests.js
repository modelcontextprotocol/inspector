#!/usr/bin/env node

/**
 * Integration tests for header functionality
 * Tests the CLI header parsing end-to-end
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, "..", "build", "index.js");

// ANSI colors for output
const colors = {
  GREEN: "\x1b[32m",
  RED: "\x1b[31m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  NC: "\x1b[0m", // No Color
};

let testsPassed = 0;
let testsFailed = 0;

/**
 * Run a CLI test with given arguments and check for expected behavior
 */
function runHeaderTest(
  testName,
  args,
  expectSuccess = false,
  expectedInOutput = null,
) {
  return new Promise((resolve) => {
    console.log(`\n${colors.BLUE}Testing: ${testName}${colors.NC}`);
    console.log(
      `${colors.BLUE}Command: node ${CLI_PATH} ${args.join(" ")}${colors.NC}`,
    );

    const child = spawn("node", [CLI_PATH, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      const output = stdout + stderr;
      let passed = true;
      let reason = "";

      // Check exit code expectation
      if (expectSuccess && code !== 0) {
        passed = false;
        reason = `Expected success (exit code 0) but got ${code}`;
      } else if (!expectSuccess && code === 0) {
        passed = false;
        reason = `Expected failure (non-zero exit code) but got success`;
      }

      // Check expected output
      if (passed && expectedInOutput && !output.includes(expectedInOutput)) {
        passed = false;
        reason = `Expected output to contain "${expectedInOutput}"`;
      }

      if (passed) {
        console.log(`${colors.GREEN}PASS: ${testName}${colors.NC}`);
        testsPassed++;
      } else {
        console.log(`${colors.RED}FAIL: ${testName}${colors.NC}`);
        console.log(`${colors.RED}Reason: ${reason}${colors.NC}`);
        console.log(`${colors.RED}Exit code: ${code}${colors.NC}`);
        console.log(`${colors.RED}Output: ${output}${colors.NC}`);
        testsFailed++;
      }

      resolve();
    });

    child.on("error", (error) => {
      console.log(
        `${colors.RED}ERROR: ${testName} - ${error.message}${colors.NC}`,
      );
      testsFailed++;
      resolve();
    });
  });
}

async function runHeaderIntegrationTests() {
  console.log(
    `${colors.YELLOW}=== MCP Inspector CLI Header Integration Tests ===${colors.NC}`,
  );
  console.log(
    `${colors.BLUE}Testing header parsing and validation${colors.NC}`,
  );

  // Test 1: Valid header format should parse successfully (connection will fail)
  await runHeaderTest(
    "Valid single header",
    [
      "https://example.com",
      "--method",
      "tools/list",
      "--transport",
      "http",
      "--header",
      "Authorization: Bearer token123",
    ],
    false,
  );

  // Test 2: Multiple headers should parse successfully
  await runHeaderTest(
    "Multiple headers",
    [
      "https://example.com",
      "--method",
      "tools/list",
      "--transport",
      "http",
      "--header",
      "Authorization: Bearer token123",
      "--header",
      "X-API-Key: secret123",
    ],
    false,
  );

  // Test 3: Invalid header format - no colon
  await runHeaderTest(
    "Invalid header format - no colon",
    [
      "https://example.com",
      "--method",
      "tools/list",
      "--transport",
      "http",
      "--header",
      "InvalidHeader",
    ],
    false,
    "Invalid header format",
  );

  // Test 4: Invalid header format - empty name
  await runHeaderTest(
    "Invalid header format - empty name",
    [
      "https://example.com",
      "--method",
      "tools/list",
      "--transport",
      "http",
      "--header",
      ": value",
    ],
    false,
    "Invalid header format",
  );

  // Test 5: Invalid header format - empty value
  await runHeaderTest(
    "Invalid header format - empty value",
    [
      "https://example.com",
      "--method",
      "tools/list",
      "--transport",
      "http",
      "--header",
      "Header:",
    ],
    false,
    "Invalid header format",
  );

  // Test 6: Header with colons in value
  await runHeaderTest(
    "Header with colons in value",
    [
      "https://example.com",
      "--method",
      "tools/list",
      "--transport",
      "http",
      "--header",
      "X-Time: 2023:12:25:10:30:45",
    ],
    false,
  );

  // Test 7: Whitespace handling
  await runHeaderTest(
    "Whitespace handling in headers",
    [
      "https://example.com",
      "--method",
      "tools/list",
      "--transport",
      "http",
      "--header",
      "  X-Header  :  value with spaces  ",
    ],
    false,
  );

  console.log(`\n${colors.YELLOW}=== Test Results ===${colors.NC}`);
  console.log(`${colors.GREEN}Tests passed: ${testsPassed}${colors.NC}`);
  console.log(`${colors.RED}Tests failed: ${testsFailed}${colors.NC}`);

  if (testsFailed === 0) {
    console.log(
      `${colors.GREEN}All header integration tests passed!${colors.NC}`,
    );
    process.exit(0);
  } else {
    console.log(
      `${colors.RED}Some header integration tests failed.${colors.NC}`,
    );
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log(`\n${colors.YELLOW}Test interrupted by user${colors.NC}`);
  process.exit(1);
});

process.on("SIGTERM", () => {
  console.log(`\n${colors.YELLOW}Test terminated${colors.NC}`);
  process.exit(1);
});

// Run the tests
runHeaderIntegrationTests().catch((error) => {
  console.error(`${colors.RED}Test runner error: ${error.message}${colors.NC}`);
  process.exit(1);
});
