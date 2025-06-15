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
  `${colors.YELLOW}=== MCP Inspector CLI Timeout Configuration Tests ===${colors.NC}`,
);
console.log(
  `${colors.BLUE}This script tests the MCP Inspector CLI's timeout configuration options:${colors.NC}`,
);
console.log(`${colors.BLUE}- Request timeout (--request-timeout)${colors.NC}`);
console.log(
  `${colors.BLUE}- Reset timeout on progress (--reset-timeout-on-progress)${colors.NC}`,
);
console.log(
  `${colors.BLUE}- Maximum total timeout (--max-total-timeout)${colors.NC}\n`,
);

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
const TEMP_DIR = fs.mkdirSync(
  path.join(os.tmpdir(), "mcp-inspector-timeout-tests"),
  {
    recursive: true,
  },
);

process.on("exit", () => {
  try {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch (err) {
    console.error(
      `${colors.RED}Failed to remove temp directory: ${err.message}${colors.NC}`,
    );
  }
});

// Helper function to analyze output for timeout behavior verification
function analyzeTimeoutBehavior(output, testName, expectedBehavior) {
  const lines = output.split("\n");

  console.log(
    `${colors.BLUE}Analyzing timeout behavior for ${testName}...${colors.NC}`,
  );

  // Extract key timing information
  const progressUpdates = lines.filter((line) =>
    line.includes("Progress update received"),
  );
  const timeoutMessages = lines.filter(
    (line) => line.includes("timeout") || line.includes("timed out"),
  );
  const errorMessages = lines.filter(
    (line) => line.includes("Error") || line.includes("Failed"),
  );

  console.log(
    `${colors.BLUE}Found ${progressUpdates.length} progress updates${colors.NC}`,
  );

  if (progressUpdates.length > 0) {
    console.log(
      `${colors.BLUE}First progress update: ${progressUpdates[0]}${colors.NC}`,
    );
    if (progressUpdates.length > 1) {
      console.log(
        `${colors.BLUE}Last progress update: ${progressUpdates[progressUpdates.length - 1]}${colors.NC}`,
      );
    }
  }

  if (timeoutMessages.length > 0) {
    console.log(
      `${colors.BLUE}Timeout messages: ${timeoutMessages.join("\n")}${colors.NC}`,
    );
  }

  if (errorMessages.length > 0) {
    console.log(
      `${colors.BLUE}Error messages: ${errorMessages.join("\n")}${colors.NC}`,
    );
  }

  switch (expectedBehavior) {
    case "should_reset_timeout":
      // For tests where resetTimeoutOnProgress is true, we expect:
      // 1. Multiple progress updates (more than 2)
      // 2. No timeout errors before completion
      // 3. Successful completion
      return (
        progressUpdates.length >= 3 &&
        !output.includes("Request timed out") &&
        !output.includes("Maximum total timeout exceeded")
      );

    case "should_timeout_quickly":
      // For tests where resetTimeoutOnProgress is false, we expect:
      // 1. Few progress updates (less than 3)
      // 2. A timeout error
      return (
        progressUpdates.length < 3 &&
        (output.includes("Request timed out") || output.includes("timed out"))
      );

    case "should_hit_max_timeout":
      // For tests where maxTotalTimeout should be hit, we expect:
      // 1. Error mentioning maximum total timeout
      return output.includes("Maximum total timeout exceeded");

    default:
      return null; // No specific expectation
  }
}

// Function to run a basic test with timeout behavior verification
async function runBasicTest(testName, expectedBehavior, ...args) {
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

        // For specific timeout behavior tests, validate the behavior
        if (expectedBehavior) {
          const behaviorCorrect = analyzeTimeoutBehavior(
            output,
            testName,
            expectedBehavior,
          );

          if (behaviorCorrect === true) {
            console.log(
              `${colors.GREEN}✓ Timeout behavior test passed: ${testName}${colors.NC}`,
            );
            PASSED_TESTS++;
            resolve(true);
            return;
          } else if (behaviorCorrect === false) {
            console.log(
              `${colors.RED}✗ Timeout behavior test failed: ${testName}${colors.NC}`,
            );
            console.log(
              `${colors.RED}Expected: ${expectedBehavior}${colors.NC}`,
            );
            console.log(
              `${colors.RED}Output did not match expected behavior${colors.NC}`,
            );
            FAILED_TESTS++;
            process.exit(1);
          }
        }

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

// Function to run an error test (expected to fail) with timeout behavior verification
async function runErrorTest(testName, expectedBehavior, ...args) {
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

        // For specific timeout behavior tests, validate the behavior
        if (expectedBehavior) {
          const behaviorCorrect = analyzeTimeoutBehavior(
            output,
            testName,
            expectedBehavior,
          );

          if (behaviorCorrect === true) {
            console.log(
              `${colors.GREEN}✓ Timeout behavior test passed: ${testName}${colors.NC}`,
            );
            PASSED_TESTS++;
            resolve(true);
            return;
          } else if (behaviorCorrect === false) {
            console.log(
              `${colors.RED}✗ Timeout behavior test failed: ${testName}${colors.NC}`,
            );
            console.log(
              `${colors.RED}Expected: ${expectedBehavior}${colors.NC}`,
            );
            console.log(
              `${colors.RED}Output did not match expected behavior${colors.NC}`,
            );
            FAILED_TESTS++;
            process.exit(1);
          }
        }

        // For error tests, we expect a non-zero exit code
        if (code !== 0) {
          // Look for specific timeout errors
          if (
            testName.includes("timeout") &&
            (output.includes("timeout") || output.includes("timed out"))
          ) {
            console.log(
              `${colors.GREEN}✓ Timeout error test passed: ${testName}${colors.NC}`,
            );
          } else {
            console.log(
              `${colors.GREEN}✓ Error test passed: ${testName}${colors.NC}`,
            );
          }

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
    `\n${colors.YELLOW}=== Running Basic Timeout Tests ===${colors.NC}`,
  );

  // Test 1: Default timeout values
  await runBasicTest(
    "default_timeouts",
    null,
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
  );

  // Test 2: Custom request timeout
  await runBasicTest(
    "custom_request_timeout",
    null,
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "longRunningOperation",
    "--tool-arg",
    "duration=5",
    "steps=5",
    "--request-timeout",
    "15000",
  );

  // Test 3: Request timeout too short (should fail)
  await runErrorTest(
    "short_request_timeout",
    "should_timeout_quickly",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "longRunningOperation",
    "--tool-arg",
    "duration=5",
    "steps=5",
    "--request-timeout",
    "100",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Progress-Related Timeout Tests ===${colors.NC}`,
  );

  // Test 4: Reset timeout on progress enabled - should complete successfully
  await runBasicTest(
    "reset_timeout_on_progress",
    "should_reset_timeout",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "longRunningOperation",
    "--tool-arg",
    "duration=15", // 15 second operation
    "steps=5", // 5 steps = progress every 3 seconds
    "--request-timeout",
    "2000", // 2 second timeout per interval
    "--reset-timeout-on-progress",
    "true",
    "--max-total-timeout",
    "30000",
  );

  // Test 5: Reset timeout on progress disabled - should fail with timeout
  await runErrorTest(
    "reset_timeout_disabled",
    "should_timeout_quickly",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "longRunningOperation",
    "--tool-arg",
    "duration=15", // Same configuration as above
    "steps=5",
    "--request-timeout",
    "2000",
    "--reset-timeout-on-progress",
    "false", // Only difference is here
    "--max-total-timeout",
    "30000",
  );

  console.log(
    `\n${colors.YELLOW}=== Running Max Total Timeout Tests ===${colors.NC}`,
  );

  // Test 6: Max total timeout exceeded (should fail)
  await runErrorTest(
    "max_total_timeout_exceeded",
    "should_hit_max_timeout",
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "longRunningOperation",
    "--tool-arg",
    "duration=10",
    "steps=10",
    "--request-timeout",
    "2000",
    "--reset-timeout-on-progress",
    "true",
    "--max-total-timeout",
    "3000", // 3 second total timeout
  );

  console.log(
    `\n${colors.YELLOW}=== Running Input Validation Tests ===${colors.NC}`,
  );

  // Test 7: Invalid request timeout value
  await runErrorTest(
    "invalid_request_timeout",
    null,
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
    "--request-timeout",
    "invalid",
  );

  // Test 8: Invalid reset-timeout-on-progress value
  await runErrorTest(
    "invalid_reset_timeout",
    null,
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
    "--reset-timeout-on-progress",
    "not-a-boolean",
  );

  // Test 9: Invalid max total timeout value
  await runErrorTest(
    "invalid_max_timeout",
    null,
    TEST_CMD,
    ...TEST_ARGS,
    "--cli",
    "--method",
    "tools/list",
    "--max-total-timeout",
    "invalid",
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

  console.log(
    `\n${colors.GREEN}All timeout configuration tests completed!${colors.NC}`,
  );
}

// Run all tests
runTests().catch((error) => {
  console.error(
    `${colors.RED}Tests failed with error: ${error.message}${colors.NC}`,
  );
  process.exit(1);
});
