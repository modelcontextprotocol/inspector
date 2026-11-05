import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import { expectValidJson } from "./helpers/assertions.js";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import {
  EXACT_LATENCY_SAMPLES,
  LATENCY_BUCKET_GROWTH,
  LatencyRecorder,
  percentile,
  summarizeLatency,
} from "@inspector/core/cli/handlers/load-latency.js";
import {
  checkLoadThresholds,
  loadThresholdBreaches,
  maxP50Parser,
  maxP95Parser,
  minThroughputParser,
  resolveLoadThresholds,
} from "@inspector/core/cli/handlers/load-thresholds.js";
import type { LoadSummary } from "@inspector/core/cli/handlers/load-test.js";

/**
 * #2838 items 4 and 6: bounded-memory latency recording, the p95 / p99.9
 * percentiles, and the p50 / p95 / throughput gates.
 */

describe("LatencyRecorder", () => {
  it("is exact up to its sample limit", () => {
    const recorder = new LatencyRecorder(1000);
    for (let i = 1; i <= 1000; i++) recorder.add(i);
    expect(recorder.summarize()).toEqual({
      min: 1,
      mean: 500.5,
      p50: 500,
      p90: 900,
      p95: 950,
      p99: 990,
      p999: 999,
      max: 1000,
    });
  });

  it("switches to the histogram past the limit, within its relative error", () => {
    const recorder = new LatencyRecorder(100);
    const values = Array.from({ length: 5000 }, (_, i) => (i + 1) / 10);
    for (const v of values) recorder.add(v);
    const summary = recorder.summarize()!;
    const sorted = [...values].sort((a, b) => a - b);
    // min, max and mean are tracked exactly, whatever the mode.
    expect(summary.min).toBe(0.1);
    expect(summary.max).toBe(500);
    expect(summary.mean).toBe(250.05);
    for (const [key, p] of [
      ["p50", 50],
      ["p90", 90],
      ["p95", 95],
      ["p99", 99],
      ["p999", 99.9],
    ] as const) {
      const exact = percentile(sorted, p);
      const error = Math.abs(summary[key] - exact) / exact;
      expect(error).toBeLessThanOrEqual(LATENCY_BUCKET_GROWTH - 1);
    }
  });

  it("keeps a bounded number of buckets however many samples arrive", () => {
    const recorder = new LatencyRecorder(10);
    for (let i = 0; i < 200_000; i++) recorder.add(5 + (i % 1000) / 100);
    // Private state, read to prove the bound: a 5–15 ms spread fits in about
    // ln(3) / ln(1.01) ≈ 111 buckets, not 200,000 entries. The double cast is
    // the only way to reach a `private` field; nothing outside this test
    // should, so the class exposes no accessor for it.
    const buckets = (recorder as unknown as { buckets: Map<number, number> })
      .buckets;
    expect(buckets.size).toBeLessThan(120);
    expect(recorder.summarize()!.p50).toBeCloseTo(10, 0);
  });

  it("clamps histogram percentiles to what was observed, and handles tiny values", () => {
    const recorder = new LatencyRecorder(1);
    recorder.add(0);
    recorder.add(0.0005);
    recorder.add(7);
    const summary = recorder.summarize()!;
    expect(summary.min).toBe(0);
    expect(summary.p50).toBe(0);
    expect(summary.max).toBe(7);
    // The top bucket's value, never above the observed max, within 1%.
    expect(summary.p999).toBeLessThanOrEqual(7);
    expect(Math.abs(summary.p999 - 7) / 7).toBeLessThanOrEqual(
      LATENCY_BUCKET_GROWTH - 1,
    );
  });

  it("never reads a percentile below the observed min", () => {
    const recorder = new LatencyRecorder(0);
    recorder.add(7);
    // Bucket 7's midpoint is just under 7; the clamp lifts it to the min.
    expect(recorder.summarize()).toMatchObject({ p50: 7, p999: 7 });
  });

  it("returns null when nothing was recorded", () => {
    expect(new LatencyRecorder().summarize()).toBeNull();
    expect(summarizeLatency([])).toBeNull();
  });

  it("defaults to the documented exact limit", () => {
    const recorder = new LatencyRecorder();
    for (let i = 0; i < EXACT_LATENCY_SAMPLES; i++) recorder.add(i);
    expect(recorder.summarize()!.p50).toBe(EXACT_LATENCY_SAMPLES / 2 - 1);
  });
});

function summary(overrides: Partial<LoadSummary> = {}): LoadSummary {
  return {
    concurrency: 1,
    requests: 10,
    ok: 10,
    toolErrors: 0,
    errors: 0,
    errorRate: 0,
    elapsedMs: 1000,
    throughput: 10,
    okThroughput: 10,
    latencyMs: {
      min: 1,
      mean: 5,
      p50: 4,
      p90: 8,
      p95: 9,
      p99: 10,
      p999: 12,
      max: 12,
    },
    errorLatencyMs: null,
    errorMessages: [],
    toolErrorMessages: [],
    ...overrides,
  };
}

describe("the p50 / p95 / throughput gates", () => {
  it("parses positive numbers", () => {
    expect(maxP50Parser("5")).toBe(5);
    expect(maxP95Parser("0.5")).toBe(0.5);
    expect(minThroughputParser("100")).toBe(100);
    expect(() => minThroughputParser("0")).toThrow(
      "--load-min-throughput must be a positive number.",
    );
  });

  it("resolves only the thresholds given", () => {
    expect(resolveLoadThresholds({})).toBeUndefined();
    expect(
      resolveLoadThresholds({ maxP50Ms: 5, minThroughput: undefined }),
    ).toEqual({ maxP50Ms: 5 });
  });

  it("passes at or within each limit", () => {
    expect(
      loadThresholdBreaches(summary(), {
        maxP50Ms: 4,
        maxP95Ms: 9,
        minThroughput: 10,
      }),
    ).toEqual([]);
  });

  it("reports every breach in the fixed order", () => {
    expect(
      loadThresholdBreaches(summary(), {
        minThroughput: 11,
        maxP99Ms: 9,
        maxP95Ms: 8,
        maxP50Ms: 3,
      }),
    ).toEqual([
      {
        code: "load_p50_exceeded",
        message: "p50 latency 4ms is above --load-max-p50 3ms",
      },
      {
        code: "load_p95_exceeded",
        message: "p95 latency 9ms is above --load-max-p95 8ms",
      },
      {
        code: "load_p99_exceeded",
        message: "p99 latency 10ms is above --load-max-p99 9ms",
      },
      {
        code: "load_throughput_below",
        message: "ok throughput 10/s is below --load-min-throughput 11/s",
      },
    ]);
  });

  it("fails a latency gate when no call succeeded", () => {
    expect(
      loadThresholdBreaches(summary({ latencyMs: null }), { maxP95Ms: 5 }),
    ).toEqual([
      {
        code: "load_p95_exceeded",
        message:
          "no call succeeded, so there is no p95 latency to check against --load-max-p95 5",
      },
    ]);
  });

  it("names the first breach in the exit code's envelope", () => {
    expect(() =>
      checkLoadThresholds(summary(), { maxP50Ms: 1, minThroughput: 100 }),
    ).toThrow(
      expect.objectContaining({
        exitCode: 10,
        envelope: { code: "load_p50_exceeded" },
      }),
    );
  });
});

describe("--load summary and gates (CLI)", () => {
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
    "20",
  ];

  it("reports p95 and p99.9", async () => {
    const result = await runCli(echoLoad);
    expect(result.exitCode).toBe(0);
    const json = expectValidJson(result) as LoadSummary;
    expect(Object.keys(json.latencyMs!)).toEqual([
      "min",
      "mean",
      "p50",
      "p90",
      "p95",
      "p99",
      "p999",
      "max",
    ]);
  });

  it("exits 10 on --load-min-throughput", async () => {
    const result = await runCli([
      ...echoLoad,
      "--load-min-throughput",
      "1000000000",
    ]);
    expect(result.exitCode).toBe(10);
    expect(result.stderr).toContain("load_throughput_below");
  });

  it("exits 10 on --load-max-p50 and --load-max-p95", async () => {
    const result = await runCli([
      ...echoLoad,
      "--load-max-p50",
      "0.000001",
      "--load-max-p95",
      "0.000001",
    ]);
    expect(result.exitCode).toBe(10);
    expect(result.stderr).toContain("load_p50_exceeded");
    expect(result.stderr).toContain("--load-max-p95");
  });

  it.each(["--load-max-p50", "--load-max-p95", "--load-min-throughput"])(
    "requires --load for %s",
    async (flag) => {
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        flag,
        "5",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`${flag} requires --load.`);
    },
  );
});
