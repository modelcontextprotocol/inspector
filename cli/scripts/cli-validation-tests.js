#!/usr/bin/env node

/**
 * CLI Input Validation Tests
 *
 * Tests the input validation functions added for security:
 * - Environment variable name/value validation
 * - Server URL validation
 * - Command validation (shell metacharacter rejection)
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for output
const colors = {
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  RED: "\x1b[31m",
  BLUE: "\x1b[34m",
  NC: "\x1b[0m",
};

// Track test results
let PASSED_TESTS = 0;
let FAILED_TESTS = 0;
let TOTAL_TESTS = 0;

const CLI_PATH = path.join(__dirname, "..", "build", "cli.js");

/**
 * Run a CLI command and capture output
 */
function runCli(args, timeout = 5000) {
  return new Promise((resolve) => {
    const proc = spawn("node", [CLI_PATH, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Kill process after timeout (CLI may hang waiting for server)
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: err.message });
    });
  });
}

/**
 * Test helper
 */
function test(name, passed, details = "") {
  TOTAL_TESTS++;
  if (passed) {
    PASSED_TESTS++;
    console.log(`${colors.GREEN}✓${colors.NC} ${name}`);
  } else {
    FAILED_TESTS++;
    console.log(`${colors.RED}✗${colors.NC} ${name}`);
    if (details) {
      console.log(`  ${colors.YELLOW}Details: ${details}${colors.NC}`);
    }
  }
}

async function runTests() {
  console.log(
    `\n${colors.YELLOW}=== CLI Input Validation Tests ===${colors.NC}\n`,
  );

  // Test 1: Valid environment variable should work
  console.log(
    `${colors.BLUE}Testing environment variable validation...${colors.NC}`,
  );
  {
    const result = await runCli(
      ["-e", "VALID_VAR=value", "--", "echo", "test"],
      3000,
    );
    // Should not see "Skipping invalid" warning for valid env var
    const hasWarning = result.stderr.includes("Skipping invalid environment");
    test(
      "Valid env var name (VALID_VAR=value) should not warn",
      !hasWarning,
      hasWarning ? `Got warning: ${result.stderr.substring(0, 100)}` : "",
    );
  }

  // Test 2: Environment variable starting with underscore should work
  {
    const result = await runCli(
      ["-e", "_PRIVATE=value", "--", "echo", "test"],
      3000,
    );
    const hasWarning = result.stderr.includes("Skipping invalid environment");
    test(
      "Env var starting with underscore (_PRIVATE=value) should not warn",
      !hasWarning,
      hasWarning ? `Got warning: ${result.stderr.substring(0, 100)}` : "",
    );
  }

  // Test 3: Invalid env var name (starts with number) should warn
  {
    const result = await runCli(
      ["-e", "123INVALID=value", "--", "echo", "test"],
      3000,
    );
    const hasWarning = result.stderr.includes(
      "Skipping invalid environment variable name",
    );
    test(
      "Env var starting with number (123INVALID) should warn and skip",
      hasWarning,
      !hasWarning
        ? `No warning found. stderr: ${result.stderr.substring(0, 100)}`
        : "",
    );
  }

  // Test 4: Invalid env var name (contains special chars) should warn
  {
    const result = await runCli(
      ["-e", "INVALID-VAR=value", "--", "echo", "test"],
      3000,
    );
    const hasWarning = result.stderr.includes(
      "Skipping invalid environment variable name",
    );
    test(
      "Env var with hyphen (INVALID-VAR) should warn and skip",
      hasWarning,
      !hasWarning
        ? `No warning found. stderr: ${result.stderr.substring(0, 100)}`
        : "",
    );
  }

  // Test 5: Server URL validation - private IP warning
  console.log(`\n${colors.BLUE}Testing server URL validation...${colors.NC}`);
  {
    const result = await runCli(
      ["--server-url", "http://localhost:3000", "--transport", "http"],
      3000,
    );
    const hasWarning = result.stderr.includes("private/internal address");
    test(
      "Private IP URL (localhost) should show warning",
      hasWarning,
      !hasWarning
        ? `No warning found. stderr: ${result.stderr.substring(0, 100)}`
        : "",
    );
  }

  // Test 6: Server URL validation - 127.0.0.1 warning
  {
    const result = await runCli(
      ["--server-url", "http://127.0.0.1:3000", "--transport", "http"],
      3000,
    );
    const hasWarning = result.stderr.includes("private/internal address");
    test(
      "Private IP URL (127.0.0.1) should show warning",
      hasWarning,
      !hasWarning
        ? `No warning found. stderr: ${result.stderr.substring(0, 100)}`
        : "",
    );
  }

  // Test 7: Server URL validation - public IP should not warn
  {
    const result = await runCli(
      ["--server-url", "https://example.com/mcp", "--transport", "http"],
      3000,
    );
    const hasWarning = result.stderr.includes("private/internal address");
    test(
      "Public URL (example.com) should not show private IP warning",
      !hasWarning,
      hasWarning
        ? `Got unexpected warning: ${result.stderr.substring(0, 100)}`
        : "",
    );
  }

  // Test 8: Command validation - shell metacharacters should error
  console.log(`\n${colors.BLUE}Testing command validation...${colors.NC}`);
  {
    const result = await runCli(["--", "node; rm -rf /"], 3000);
    const hasError =
      result.stderr.includes("shell metacharacters") || result.code !== 0;
    test(
      "Command with semicolon (node; rm -rf /) should error",
      hasError,
      !hasError
        ? `Expected error. code: ${result.code}, stderr: ${result.stderr.substring(0, 100)}`
        : "",
    );
  }

  // Test 9: Command validation - pipe character should error
  {
    const result = await runCli(["--", "cat /etc/passwd | grep root"], 3000);
    const hasError =
      result.stderr.includes("shell metacharacters") || result.code !== 0;
    test(
      "Command with pipe (cat | grep) should error",
      hasError,
      !hasError
        ? `Expected error. code: ${result.code}, stderr: ${result.stderr.substring(0, 100)}`
        : "",
    );
  }

  // Test 10: Command validation - backticks should error
  {
    const result = await runCli(["--", "echo `whoami`"], 3000);
    const hasError =
      result.stderr.includes("shell metacharacters") || result.code !== 0;
    test(
      "Command with backticks (echo `whoami`) should error",
      hasError,
      !hasError
        ? `Expected error. code: ${result.code}, stderr: ${result.stderr.substring(0, 100)}`
        : "",
    );
  }

  // Test 11: Command validation - valid command should work
  {
    const result = await runCli(["--", "node", "--version"], 3000);
    // Should not error due to metacharacters
    const hasMetacharError = result.stderr.includes("shell metacharacters");
    test(
      "Valid command (node --version) should not error on metacharacters",
      !hasMetacharError,
      hasMetacharError
        ? `Got unexpected error: ${result.stderr.substring(0, 100)}`
        : "",
    );
  }

  // Print summary
  console.log(`\n${colors.YELLOW}=== Test Summary ===${colors.NC}`);
  console.log(`Total: ${TOTAL_TESTS}`);
  console.log(`${colors.GREEN}Passed: ${PASSED_TESTS}${colors.NC}`);
  console.log(`${colors.RED}Failed: ${FAILED_TESTS}${colors.NC}`);

  if (FAILED_TESTS > 0) {
    console.log(
      `\n${colors.RED}Some tests failed. Please review the validation implementation.${colors.NC}`,
    );
    process.exit(1);
  } else {
    console.log(`\n${colors.GREEN}All validation tests passed!${colors.NC}`);
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error(`${colors.RED}Test runner error: ${err.message}${colors.NC}`);
  process.exit(1);
});
