import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliSuccess, expectValidJson } from "./helpers/assertions.js";
import {
  getTestMcpServerCommand,
  getCrashableTestMcpServerCommand,
  CRASH_SERVER_TOOL_NAME,
} from "@modelcontextprotocol/inspector-test-server";
import {
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/core/cli/error-handler.js";
import type { LoadSummary } from "@inspector/core/cli/handlers/load-test.js";
import {
  LOAD_ERROR_RATE_EXCEEDED,
  LOAD_P99_EXCEEDED,
  checkLoadThresholds,
  fractionParser,
  maxP99Parser,
  resolveLoadThresholds,
  type LoadThresholds,
} from "@inspector/core/cli/handlers/load-thresholds.js";

/** A summary with only the fields a test cares about overridden. */
function summary(overrides: Partial<LoadSummary> = {}): LoadSummary {
  return {
    tool: "echo",
    concurrency: 1,
    requests: 100,
    ok: 100,
    toolErrors: 0,
    errors: 0,
    errorRate: 0,
    elapsedMs: 100,
    throughput: 1000,
    okThroughput: 1000,
    latencyMs: { min: 1, mean: 2, p50: 2, p90: 3, p99: 4, max: 5 },
    errorLatencyMs: null,
    errorMessages: [],
    toolErrorMessages: [],
    ...overrides,
  };
}

/** Run the check and return the thrown error, or undefined when it passed. */
function judge(
  s: LoadSummary,
  t: LoadThresholds | undefined,
): CliExitCodeError | undefined {
  try {
    checkLoadThresholds(s, t);
    return undefined;
  } catch (err) {
    expect(err).toBeInstanceOf(CliExitCodeError);
    return err as CliExitCodeError;
  }
}

describe("load thresholds", () => {
  describe("fractionParser", () => {
    const parse = fractionParser("--load-max-error-rate");

    it("accepts 0 through 1 inclusive", () => {
      expect(parse("0")).toBe(0);
      expect(parse("0.05")).toBe(0.05);
      expect(parse(" 1 ")).toBe(1);
    });

    it.each(["", " ", "-0.1", "1.01", "5", "NaN", "Infinity", "abc"])(
      "refuses %j",
      (value) => {
        expect(() => parse(value)).toThrow(
          "--load-max-error-rate must be a number from 0 to 1.",
        );
      },
    );
  });

  it("parses --load-max-p99 as a positive number", () => {
    expect(maxP99Parser("250")).toBe(250);
    expect(() => maxP99Parser("0")).toThrow(
      "--load-max-p99 must be a positive number.",
    );
  });

  describe("resolveLoadThresholds", () => {
    it("is undefined when neither flag is set", () => {
      expect(resolveLoadThresholds({})).toBeUndefined();
    });

    it("keeps only the thresholds that were given", () => {
      expect(resolveLoadThresholds({ maxErrorRate: 0 })).toEqual({
        maxErrorRate: 0,
      });
      expect(resolveLoadThresholds({ maxP99Ms: 50 })).toEqual({
        maxP99Ms: 50,
      });
      expect(
        resolveLoadThresholds({ maxErrorRate: 0.1, maxP99Ms: 50 }),
      ).toEqual({ maxErrorRate: 0.1, maxP99Ms: 50 });
    });
  });

  describe("checkLoadThresholds", () => {
    const failing = summary({
      ok: 90,
      toolErrors: 4,
      errors: 6,
      errorRate: 0.1,
    });

    it("passes when no thresholds are set, whatever the summary", () => {
      expect(judge(failing, undefined)).toBeUndefined();
      expect(judge(failing, {})).toBeUndefined();
    });

    it("passes at the threshold and fails above it", () => {
      expect(judge(failing, { maxErrorRate: 0.1 })).toBeUndefined();
      const err = judge(failing, { maxErrorRate: 0.05 });
      expect(err?.exitCode).toBe(EXIT_CODES.LOAD_THRESHOLD_EXCEEDED);
      expect(err?.envelope?.code).toBe(LOAD_ERROR_RATE_EXCEEDED);
      expect(err?.message).toBe(
        "Load threshold exceeded: error rate 0.1 (10 of 100 calls failed) is above --load-max-error-rate 0.05.",
      );
    });

    it("fails a zero threshold on one failure the rounded rate hides", () => {
      const rare = summary({
        requests: 30_000,
        ok: 29_999,
        errors: 1,
        // 1 / 30 000 rounds to 0 at four places.
        errorRate: 0,
      });
      expect(judge(rare, { maxErrorRate: 0 })?.envelope?.code).toBe(
        LOAD_ERROR_RATE_EXCEEDED,
      );
    });

    it("treats a run with no completed calls as a zero error rate", () => {
      const empty = summary({ requests: 0, ok: 0, latencyMs: null });
      expect(judge(empty, { maxErrorRate: 0 })).toBeUndefined();
    });

    it("fails p99 above the threshold and passes at it", () => {
      expect(judge(summary(), { maxP99Ms: 4 })).toBeUndefined();
      const err = judge(summary(), { maxP99Ms: 3.5 });
      expect(err?.exitCode).toBe(EXIT_CODES.LOAD_THRESHOLD_EXCEEDED);
      expect(err?.envelope?.code).toBe(LOAD_P99_EXCEEDED);
      expect(err?.message).toContain(
        "p99 latency 4ms is above --load-max-p99 3.5ms",
      );
    });

    it("fails a p99 threshold when no call succeeded, and says why", () => {
      const err = judge(summary({ requests: 0, ok: 0, latencyMs: null }), {
        maxP99Ms: 100,
      });
      expect(err?.envelope?.code).toBe(LOAD_P99_EXCEEDED);
      expect(err?.message).toContain(
        "no call succeeded, so there is no p99 latency to check",
      );
    });

    it("names every breach and codes the error rate first", () => {
      const err = judge(failing, { maxErrorRate: 0, maxP99Ms: 1 });
      expect(err?.envelope?.code).toBe(LOAD_ERROR_RATE_EXCEEDED);
      expect(err?.message).toContain("is above --load-max-error-rate 0");
      expect(err?.message).toContain("p99 latency 4ms is above");
    });
  });
});

describe("--load thresholds (CLI)", () => {
  const { command, args } = getTestMcpServerCommand();
  const echoLoad = [
    command,
    ...args,
    "--cli",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--tool-arg",
    "message=hi",
    "--load",
    "--load-requests",
    "5",
  ];

  it("exits 0 when every threshold holds", async () => {
    const result = await runCli([
      ...echoLoad,
      "--load-max-error-rate",
      "0",
      "--load-max-p99",
      "60000",
    ]);
    expectCliSuccess(result);
    expect(expectValidJson(result)).toMatchObject({ requests: 5, errors: 0 });
  });

  it("prints the summary, then exits 10 naming the p99 threshold", async () => {
    // No real call completes in a hundredth of a microsecond.
    const result = await runCli([...echoLoad, "--load-max-p99", "0.00001"]);
    expect(result.exitCode).toBe(EXIT_CODES.LOAD_THRESHOLD_EXCEEDED);
    expect(expectValidJson(result)).toMatchObject({ tool: "echo", ok: 5 });
    const envelope = JSON.parse(result.stderr.trim().split("\n").pop()!);
    expect(envelope.error.code).toBe(LOAD_P99_EXCEEDED);
  });

  it("exits 10 naming the error rate when calls fail", async () => {
    const crashable = getCrashableTestMcpServerCommand();
    const result = await runCli([
      crashable.command,
      ...crashable.args,
      "--cli",
      "--format",
      "json",
      "--method",
      "tools/call",
      "--tool-name",
      CRASH_SERVER_TOOL_NAME,
      "--load",
      "--load-requests",
      "2",
      "--load-concurrency",
      "1",
      "--load-max-error-rate",
      "0.5",
    ]);
    expect(result.exitCode).toBe(EXIT_CODES.LOAD_THRESHOLD_EXCEEDED);
    expect(expectValidJson(result).result).toMatchObject({
      requests: 2,
      errorRate: 1,
    });
    expect(result.stderr).toContain(LOAD_ERROR_RATE_EXCEEDED);
  });

  it.each([
    [
      ["--method", "tools/call", "--load-max-error-rate", "0.1"],
      "--load-max-error-rate requires --load.",
    ],
    [
      ["--method", "tools/call", "--load-max-p99", "100"],
      "--load-max-p99 requires --load.",
    ],
    [
      ["--method", "tools/call", "--load", "--load-max-error-rate", "5"],
      "--load-max-error-rate must be a number from 0 to 1.",
    ],
    [
      ["--method", "tools/call", "--load", "--load-max-p99", "-1"],
      "--load-max-p99 must be a positive number.",
    ],
  ])("rejects %j", async (flags, message) => {
    const result = await runCli([command, ...args, "--cli", ...flags]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(message);
  });
});
