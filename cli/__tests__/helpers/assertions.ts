import { expect } from "vitest";
import type { CliResult } from "./cli-runner.js";

function formatCliOutput(result: CliResult): string {
  const out = result.stdout?.trim() || "(empty)";
  const err = result.stderr?.trim() || "(empty)";
  return `stdout: ${out}\nstderr: ${err}`;
}

/**
 * Assert that CLI command succeeded (exit code 0)
 */
export function expectCliSuccess(result: CliResult) {
  expect(
    result.exitCode,
    `CLI exited with code ${result.exitCode}. ${formatCliOutput(result)}`,
  ).toBe(0);
}

/**
 * Assert that CLI command failed (non-zero exit code)
 */
export function expectCliFailure(result: CliResult) {
  expect(
    result.exitCode,
    `CLI unexpectedly exited with code ${result.exitCode}. ${formatCliOutput(result)}`,
  ).not.toBe(0);
}

/**
 * Assert that output contains expected text
 */
export function expectOutputContains(result: CliResult, text: string) {
  expect(result.output).toContain(text);
}

/**
 * Assert that output contains valid JSON
 * Uses stdout (not stderr) since JSON is written to stdout and warnings go to stderr
 */
export function expectValidJson(result: CliResult) {
  expect(() => JSON.parse(result.stdout)).not.toThrow();
  return JSON.parse(result.stdout);
}

/**
 * Assert that output contains JSON with error flag
 */
export function expectJsonError(result: CliResult) {
  const json = expectValidJson(result);
  expect(json.isError).toBe(true);
  return json;
}

/**
 * Assert that output contains expected JSON structure
 */
export function expectJsonStructure(result: CliResult, expectedKeys: string[]) {
  const json = expectValidJson(result);
  expectedKeys.forEach((key) => {
    expect(json).toHaveProperty(key);
  });
  return json;
}
