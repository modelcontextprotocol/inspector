import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliFailure,
  expectCliSuccess,
  expectValidJson,
} from "./helpers/assertions.js";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import {
  formatLoadProgress,
  resolveLoadOptions,
  runLoad,
  type LoadProgress,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import { fakeClock } from "./helpers/load-clock.js";

/**
 * #2838 items 1–3: progress reports, the `--load-interval` time series, and
 * the `--load-warmup` window left out of the statistics.
 */

/** A call that takes `ms` on the fake clock, then succeeds. */
function timedCall(clock: ReturnType<typeof fakeClock>, ms: number) {
  return async (): Promise<"ok"> => {
    await clock.sleep(ms);
    return "ok";
  };
}

describe("resolveLoadOptions for #2838", () => {
  it("turns seconds into the engine's milliseconds", () => {
    expect(
      resolveLoadOptions({
        durationSec: 2,
        intervalSec: 0.5,
        warmupSec: 1,
        progressSec: 5,
      }),
    ).toMatchObject({
      durationMs: 2000,
      intervalMs: 500,
      warmupMs: 1000,
      progressMs: 5000,
    });
  });

  it("refuses a warm-up before stages", () => {
    expect(() =>
      resolveLoadOptions({
        warmupSec: 1,
        stages: { by: "concurrency", levels: [1], stageMs: 1000 },
      }),
    ).toThrow(
      "--load-warmup cannot be combined with --load-steps or --load-ramp",
    );
  });
});

describe("--load-warmup (engine)", () => {
  it("runs the warm-up first and leaves it out of every figure", async () => {
    const clock = fakeClock();
    const starts: { at: number; seq: number }[] = [];
    const summary = await runLoad(
      async (_w, _s, seq) => {
        starts.push({ at: clock.now(), seq });
        await clock.sleep(10);
        return "ok";
      },
      { concurrency: 1, durationMs: 100, warmupMs: 50 },
      clock,
    );
    expect(summary.warmup).toEqual({
      durationMs: 50,
      requests: 5,
      ok: 5,
      failed: 0,
    });
    // Measured from the end of the warm-up: 10 calls in 100 ms.
    expect(summary).toMatchObject({ requests: 10, ok: 10, elapsedMs: 100 });
    expect(starts[5]).toEqual({ at: 1050, seq: 6 });
    expect(starts.map((s) => s.seq)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
  });

  it("ends the run in the warm-up when the server is gone", async () => {
    const clock = fakeClock();
    let calls = 0;
    const summary = await runLoad(
      async () => {
        calls++;
        await clock.sleep(1);
        throw new Error("refused");
      },
      { concurrency: 1, durationMs: 10_000, warmupMs: 10_000 },
      clock,
    );
    expect(summary.warmup?.stoppedEarly?.reason).toBe("consecutive_errors");
    expect(summary.stoppedEarly?.reason).toBe("consecutive_errors");
    expect(summary.requests).toBe(0);
    expect(summary.warmup?.failed).toBe(calls);
  });
});

describe("--load-interval (engine)", () => {
  it("buckets calls by completion time, filling empty intervals", async () => {
    const clock = fakeClock();
    let n = 0;
    const summary = await runLoad(
      async () => {
        n++;
        // The 3rd call stalls for 120 ms, leaving an empty interval.
        await clock.sleep(n === 3 ? 120 : 10);
        if (n === 2) throw new Error("boom");
        return "ok";
      },
      { concurrency: 1, durationMs: 200, intervalMs: 50 },
      clock,
    );
    const rows = summary.intervals!;
    expect(rows.map((r) => [r.startMs, r.endMs])).toEqual([
      [0, 50],
      [50, 100],
      [100, 150],
      [150, 200],
    ]);
    expect(rows[0]).toMatchObject({ requests: 2, ok: 1, errors: 1 });
    expect(rows[1]).toMatchObject({
      requests: 0,
      throughput: 0,
      latencyMs: null,
    });
    expect(rows.reduce((t, r) => t + r.requests, 0)).toBe(summary.requests);
    expect(rows[2]!.latencyMs?.max).toBe(120);
  });

  it("carries a time series per stage", async () => {
    const clock = fakeClock();
    const summary = await runLoad(
      timedCall(clock, 10),
      {
        concurrency: 2,
        intervalMs: 50,
        stages: { by: "concurrency", levels: [1, 2], stageMs: 100 },
      },
      clock,
    );
    expect(summary.stages!.map((s) => s.intervals!.length)).toEqual([2, 2]);
    expect(summary).not.toHaveProperty("intervals");
  });
});

describe("progress reports (engine)", () => {
  it("reports totals and the last interval's rate and latency", async () => {
    const clock = fakeClock();
    const reports: LoadProgress[] = [];
    await runLoad(
      timedCall(clock, 10),
      { concurrency: 1, durationMs: 100 },
      clock,
      undefined,
      { everyMs: 30, emit: (p) => reports.push(p) },
    );
    expect(reports.length).toBeGreaterThanOrEqual(3);
    expect(reports[0]).toMatchObject({
      phase: "run",
      elapsedMs: 30,
      failed: 0,
      latencyMs: { p50: 10, p99: 10 },
    });
    expect(reports[0]!.requests).toBe(reports[0]!.ok);
    expect(reports[0]).not.toHaveProperty("stage");
    expect(reports.at(-1)!.requests).toBeGreaterThan(reports[0]!.requests);
  });

  it("labels the warm-up and each stage", async () => {
    const clock = fakeClock();
    const reports: LoadProgress[] = [];
    const emit = (p: LoadProgress) => reports.push(p);
    await runLoad(
      timedCall(clock, 10),
      { concurrency: 1, durationMs: 40, warmupMs: 40 },
      clock,
      undefined,
      { everyMs: 20, emit },
    );
    expect(new Set(reports.map((r) => r.phase))).toEqual(
      new Set(["warmup", "run"]),
    );
    reports.length = 0;
    await runLoad(
      timedCall(clock, 10),
      {
        concurrency: 1,
        stages: { by: "concurrency", levels: [1, 1], stageMs: 40 },
      },
      clock,
      undefined,
      { everyMs: 20, emit },
    );
    expect(new Set(reports.map((r) => r.stage))).toEqual(new Set([1, 2]));
  });

  it("reports no latency for an interval with no successes", async () => {
    const clock = fakeClock();
    const reports: LoadProgress[] = [];
    await runLoad(
      async () => {
        await clock.sleep(10);
        return { outcome: "tool_error", message: "no" };
      },
      { concurrency: 1, durationMs: 50 },
      clock,
      undefined,
      { everyMs: 25, emit: (p) => reports.push(p) },
    );
    expect(reports[0]).toMatchObject({ ok: 0, latencyMs: null });
    expect(reports[0]!.failed).toBeGreaterThan(0);
  });

  it("formats one line per report", () => {
    const base: LoadProgress = {
      phase: "run",
      elapsedMs: 12_000,
      requests: 1234,
      ok: 1230,
      failed: 4,
      throughput: 102.3,
      latencyMs: { p50: 12.1, p99: 40.2 },
    };
    expect(formatLoadProgress(base)).toBe(
      "[load 12.0s] 1234 calls (1230 ok, 4 failed), 102.3/s, p50 12.1 / p99 40.2 ms",
    );
    expect(formatLoadProgress({ ...base, phase: "warmup" })).toMatch(
      /^\[load warm-up 12\.0s\]/,
    );
    expect(formatLoadProgress({ ...base, stage: 3, latencyMs: null })).toBe(
      "[load stage 3 12.0s] 1234 calls (1230 ok, 4 failed), 102.3/s, no successes",
    );
  });
});

describe("--load-interval / --load-warmup / --load-progress (CLI)", () => {
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
  ];

  it("prints progress on stderr, a time series and a warm-up", async () => {
    const result = await runCli([
      ...echoLoad,
      "--load-duration",
      "0.4",
      "--load-warmup",
      "0.2",
      "--load-interval",
      "0.2",
      "--load-progress",
      "0.1",
    ]);
    expectCliSuccess(result);
    const summary = expectValidJson(result) as LoadSummary;
    // Two 0.2 s intervals, plus one more when a call drains past the window.
    expect(summary.intervals!.length).toBeGreaterThanOrEqual(2);
    expect(summary.intervals!.length).toBeLessThanOrEqual(3);
    expect(summary.warmup?.durationMs).toBe(200);
    expect(summary.warmup!.requests).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/\[load warm-up \d+\.\ds\] \d+ calls/);
    expect(result.stderr).toMatch(/\[load \d+\.\ds\] \d+ calls/);
  });

  it("prints no progress with --quiet", async () => {
    const result = await runCli([
      ...echoLoad,
      "--load-duration",
      "0.3",
      "--load-progress",
      "0.1",
      "--quiet",
    ]);
    expectCliSuccess(result);
    expect(result.stderr).not.toContain("[load");
  });

  it("refuses a warm-up with stages", async () => {
    const result = await runCli([
      ...echoLoad,
      "--load-steps",
      "1",
      "--load-warmup",
      "1",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toContain(
      "--load-warmup cannot be combined with --load-steps",
    );
  });

  it.each(["--load-interval", "--load-warmup", "--load-progress"])(
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
        "1",
      ]);
      expectCliFailure(result);
      expect(result.stderr).toContain(`${flag} requires --load.`);
    },
  );
});
