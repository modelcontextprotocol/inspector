import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliFailure,
  expectCliSuccess,
  expectValidJson,
} from "./helpers/assertions.js";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import {
  DEFAULT_LOAD_STEP_DURATION_SEC,
  loadRampParser,
  loadStepByParser,
  loadStepsParser,
  rampLevels,
  resolveLoadStages,
} from "@inspector/core/cli/handlers/load-stages.js";
import {
  loadSummaryWarnings,
  resolveLoadOptions,
  runLoad,
  type LoadCallOutcome,
  type LoadClock,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import {
  checkLoadThresholds,
  loadThresholdBreaches,
} from "@inspector/core/cli/handlers/load-thresholds.js";
import { validateLoadScenario } from "@inspector/core/cli/handlers/load-scenario.js";
import { fakeClock } from "./helpers/load-clock.js";

/**
 * Stepped and ramped load (#2841): planning the stages from the flags,
 * running them, judging each, and the one-shot CLI end to end.
 */

describe("stage flag parsers", () => {
  it("parses a comma-separated step list", () => {
    expect(loadStepsParser("10, 25,50")).toEqual([10, 25, 50]);
    expect(loadStepsParser("2.5")).toEqual([2.5]);
    for (const bad of ["", "10,,20", "0,1", "-1", "a,b", "1,Infinity"]) {
      expect(() => loadStepsParser(bad)).toThrow(
        "--load-steps must be a comma-separated list of positive numbers",
      );
    }
  });

  it("parses a ramp of three positive numbers", () => {
    expect(loadRampParser("10:100:60")).toEqual({
      from: 10,
      to: 100,
      durationSec: 60,
    });
    for (const bad of ["10:100", "10:100:60:1", "0:10:5", "a:b:c", "1::5"]) {
      expect(() => loadRampParser(bad)).toThrow(
        "--load-ramp must be <from>:<to>:<seconds>",
      );
    }
  });

  it("accepts concurrency or rate for --load-step-by", () => {
    expect(loadStepByParser("rate")).toBe("rate");
    expect(loadStepByParser("concurrency")).toBe("concurrency");
    expect(() => loadStepByParser("both")).toThrow(
      "--load-step-by must be concurrency or rate.",
    );
  });
});

describe("rampLevels", () => {
  it("spaces levels evenly from from to to, both included", () => {
    expect(
      rampLevels({ from: 10, to: 100, durationSec: 60 }, 4, "concurrency"),
    ).toEqual([10, 40, 70, 100]);
    expect(rampLevels({ from: 1, to: 2, durationSec: 1 }, 3, "rate")).toEqual([
      1, 1.5, 2,
    ]);
    // Rates are kept exact, so a valid low rate never becomes zero.
    expect(
      rampLevels({ from: 0.0001, to: 0.0004, durationSec: 30 }, 2, "rate"),
    ).toEqual([0.0001, 0.0004]);
  });

  it("rounds concurrency to whole workers and runs one stage at to", () => {
    expect(
      rampLevels({ from: 1, to: 2, durationSec: 1 }, 4, "concurrency"),
    ).toEqual([1, 1, 2, 2]);
    expect(
      rampLevels({ from: 5, to: 9, durationSec: 1 }, 1, "concurrency"),
    ).toEqual([9]);
    expect(
      rampLevels({ from: 0.2, to: 0.3, durationSec: 1 }, 2, "concurrency"),
    ).toEqual([1, 1]);
  });
});

describe("resolveLoadStages", () => {
  it("returns undefined without steps or a ramp", () => {
    expect(resolveLoadStages({})).toBeUndefined();
  });

  it("plans steps at the default stage length", () => {
    expect(resolveLoadStages({ steps: [1, 5] })).toEqual({
      by: "concurrency",
      levels: [1, 5],
      stageMs: DEFAULT_LOAD_STEP_DURATION_SEC * 1000,
    });
  });

  it("splits a ramp evenly into step-duration stages", () => {
    expect(
      resolveLoadStages({
        ramp: { from: 10, to: 50, durationSec: 24 },
        stepDurationSec: 10,
        stepBy: "rate",
      }),
    ).toEqual({ by: "rate", levels: [10, 50], stageMs: 12_000 });
    expect(
      resolveLoadStages({ ramp: { from: 1, to: 8, durationSec: 2 } })?.levels,
    ).toEqual([8]);
  });

  it("carries the thresholds with --load-stop-on-breach", () => {
    expect(
      resolveLoadStages({
        steps: [1],
        stopOnBreach: true,
        thresholds: { maxP99Ms: 5 },
      }),
    ).toMatchObject({ stopOnBreach: { maxP99Ms: 5 } });
  });

  it.each([
    [
      { stepBy: "rate" as const },
      "--load-step-by requires --load-steps or --load-ramp.",
    ],
    [
      { stepDurationSec: 1 },
      "--load-step-duration requires --load-steps or --load-ramp.",
    ],
    [
      { stopOnBreach: true },
      "--load-stop-on-breach requires --load-steps or --load-ramp.",
    ],
    [
      { steps: [1], ramp: { from: 1, to: 2, durationSec: 1 } },
      "--load-steps cannot be combined with --load-ramp.",
    ],
    [
      { steps: [1], durationSec: 5 },
      "--load-steps cannot be combined with --load-duration or --load-requests",
    ],
    [
      { ramp: { from: 1, to: 2, durationSec: 1 }, requests: 5 },
      "--load-ramp cannot be combined with --load-duration or --load-requests",
    ],
    [
      { steps: [1], concurrency: 4 },
      "--load-steps sets the concurrency of each stage, so it cannot be combined with --load-concurrency",
    ],
    [
      { steps: [1], stepBy: "rate" as const, rate: 4 },
      "--load-steps with --load-step-by rate sets the rate of each stage, so it cannot be combined with --load-rate.",
    ],
    [
      { steps: [1.5] },
      "--load-steps must be whole numbers when stepping concurrency.",
    ],
    [
      { steps: [1], stopOnBreach: true },
      "--load-stop-on-breach requires --load-max-error-rate or --load-max-p99.",
    ],
  ])("refuses %j", (flags, message) => {
    expect(() => resolveLoadStages(flags)).toThrow(message);
  });

  it("allows fractional rate steps over a fixed pool", () => {
    expect(
      resolveLoadStages({ steps: [0.5, 2], stepBy: "rate", concurrency: 3 })
        ?.levels,
    ).toEqual([0.5, 2]);
  });
});

describe("resolveLoadOptions with stages", () => {
  const stages = { by: "concurrency" as const, levels: [2, 8], stageMs: 1000 };

  it("takes the highest level as concurrency and sets no window", () => {
    expect(resolveLoadOptions({ stages })).toEqual({ concurrency: 8, stages });
  });

  it("keeps the pool when stepping the rate", () => {
    const rate = { by: "rate" as const, levels: [5], stageMs: 1000 };
    expect(resolveLoadOptions({ stages: rate, concurrency: 3 })).toEqual({
      concurrency: 3,
      stages: rate,
    });
  });

  it("refuses more connections than the smallest stage has workers", () => {
    expect(() => resolveLoadOptions({ stages, connections: 3 })).toThrow(
      "--load-connections (3) cannot exceed the smallest concurrency stage (2)",
    );
  });
});

describe("runLoad with stages", () => {
  it("runs each stage at its own concurrency, numbering calls across them", async () => {
    const clock = fakeClock();
    let inFlight = 0;
    const peaks: number[] = [];
    const seqs: number[] = [];
    const call = async (
      _w: number,
      _s: number,
      seq: number,
    ): Promise<LoadCallOutcome> => {
      seqs.push(seq);
      inFlight++;
      const stage = clock.now() < 1100 ? 0 : 1;
      peaks[stage] = Math.max(peaks[stage] ?? 0, inFlight);
      await clock.sleep(10);
      inFlight--;
      return "ok";
    };
    const summary = await runLoad(
      call,
      {
        concurrency: 4,
        stages: { by: "concurrency", levels: [1, 4], stageMs: 100 },
      },
      clock,
    );
    expect(peaks).toEqual([1, 4]);
    expect(
      summary.stages!.map((s) => [s.stage, s.level, s.concurrency]),
    ).toEqual([
      [1, 1, 1],
      [2, 4, 4],
    ]);
    const [one, two] = summary.stages!;
    expect(one!.requests).toBe(10);
    expect(two!.requests).toBe(40);
    expect(summary).toMatchObject({
      concurrency: 4,
      durationMs: 200,
      requests: 50,
      ok: 50,
    });
    expect(summary.elapsedMs).toBe(one!.elapsedMs + two!.elapsedMs);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(summary.latencyMs).toMatchObject({ min: 10, max: 10 });
    expect(summary).not.toHaveProperty("rate");
  });

  it("steps the rate over a fixed pool", async () => {
    const clock = fakeClock();
    const summary = await runLoad(
      async () => "ok",
      {
        concurrency: 2,
        rate: 99,
        stages: { by: "rate", levels: [10, 50], stageMs: 1000 },
      },
      clock,
    );
    expect(
      summary.stages!.map((s) => [s.stepBy, s.level, s.rate, s.requests]),
    ).toEqual([
      ["rate", 10, 10, 10],
      ["rate", 50, 50, 50],
    ]);
    expect(summary.stages!.every((s) => s.concurrency === 2)).toBe(true);
  });

  it("starts each rate-limited stage at its real deadline, not early", async () => {
    const clock = fakeClock();
    const starts: number[] = [];
    const summary = await runLoad(
      async () => {
        starts.push(clock.now());
        await clock.sleep(10);
        return "ok";
      },
      {
        concurrency: 1,
        stages: { by: "rate", levels: [1, 2], stageMs: 1000 },
      },
      clock,
    );
    // The fake clock starts at 1000: stage 1 at 1000, stage 2 at 2000.
    expect(starts).toEqual([1000, 2000, 2500]);
    expect(clock.now()).toBeGreaterThanOrEqual(2510);
    expect(summary.stages!.map((s) => s.requests)).toEqual([1, 2]);
  });

  /**
   * A clock whose short sleeps pass at once and whose long ones (the wait
   * between stages) never end on their own, so an abort is the only way
   * out of that wait.
   */
  function stallingClock(): LoadClock {
    let t = 0;
    return {
      now: () => t,
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          if (ms > 1000) return;
          t += ms;
          setImmediate(resolve);
        }),
    };
  }

  it("stops in the wait between stages when the run aborts", async () => {
    const controller = new AbortController();
    const clock = stallingClock();
    const summary = await runLoad(
      async () => {
        await clock.sleep(1);
        // Abort once the stage's only start is done, during the wait.
        setImmediate(() =>
          controller.abort({ reason: "connection_lost", detail: "gone" }),
        );
        return "ok";
      },
      {
        concurrency: 1,
        stages: { by: "rate", levels: [0.001, 1], stageMs: 1_000_000 },
      },
      clock,
      controller.signal,
    );
    expect(summary.stages).toHaveLength(1);
    const lost = { reason: "connection_lost", detail: "gone" };
    expect(summary.stoppedEarly).toEqual(lost);
    // The stage itself records the stop, and the time that actually passed
    // (1 ms on this clock), not its padded 1,000,000 ms window.
    const [stage] = summary.stages!;
    expect(stage!.stoppedEarly).toEqual(lost);
    expect(stage!.elapsedMs).toBe(1);
    expect(stage!.throughput).toBe(1000);
    expect(summary.elapsedMs).toBe(1);
  });

  it("reports a plain abort in the wait as an interrupt", async () => {
    const controller = new AbortController();
    const clock = stallingClock();
    const summary = await runLoad(
      async () => {
        await clock.sleep(1);
        setImmediate(() => controller.abort());
        return "ok";
      },
      {
        concurrency: 1,
        stages: { by: "rate", levels: [0.001, 1], stageMs: 1_000_000 },
      },
      clock,
      controller.signal,
    );
    expect(summary.stoppedEarly?.reason).toBe("interrupted");
    expect(summary.stages![0]!.stoppedEarly?.reason).toBe("interrupted");
  });

  it("trips the circuit breaker across single-call stages", async () => {
    const clock = fakeClock();
    const summary = await runLoad(
      async () => {
        await clock.sleep(10);
        throw new Error("refused");
      },
      {
        concurrency: 1,
        // One call per stage: each failure lands after its stage's only
        // start, so only the run-wide view can tell the server is gone.
        stages: {
          by: "rate",
          levels: Array.from({ length: 80 }, () => 1),
          stageMs: 1000,
        },
      },
      clock,
    );
    expect(summary.stoppedEarly?.reason).toBe("consecutive_errors");
    // At least five failures over a second trips it, long before 80 stages.
    expect(summary.stages!.length).toBeLessThan(10);
  });

  it("continues the weighted step cycle across stages", async () => {
    const clock = fakeClock();
    const picked: number[] = [];
    await runLoad(
      async (_w, step) => {
        picked.push(step);
        await clock.sleep(10);
        return "ok";
      },
      {
        concurrency: 1,
        scenario: validateLoadScenario([
          { method: "tools/call", tool: "heavy", weight: 3 },
          { method: "tools/call", tool: "light", weight: 1 },
        ]),
        // Two calls per stage: a fresh 3:1 cycle each stage would pick
        // heavy, heavy every time and never reach light.
        stages: { by: "concurrency", levels: [1, 1, 1, 1], stageMs: 20 },
      },
      clock,
    );
    expect(picked).toEqual([0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it("trips the circuit breaker on failures spanning stage boundaries", async () => {
    const clock = fakeClock();
    const summary = await runLoad(
      async () => {
        await clock.sleep(20);
        throw new Error("refused");
      },
      {
        concurrency: 1,
        // 20 failures per stage, fewer than the breaker's 50, but every call
        // throws, so the shared streak trips it partway through stage 3.
        stages: { by: "concurrency", levels: [1, 1, 1, 1, 1], stageMs: 400 },
      },
      clock,
    );
    expect(summary.stoppedEarly?.reason).toBe("consecutive_errors");
    expect(summary.stages!.length).toBeLessThan(5);
    expect(summary.errors).toBeLessThan(100);
  });

  it("keeps a fixed rate on every concurrency stage", async () => {
    const summary = await runLoad(
      async () => "ok",
      {
        concurrency: 2,
        rate: 10,
        stages: { by: "concurrency", levels: [1, 2], stageMs: 500 },
      },
      fakeClock(),
    );
    expect(summary.stages!.map((s) => s.rate)).toEqual([10, 10]);
  });

  it("stops after the first stage that breaches with stopOnBreach", async () => {
    const clock = fakeClock();
    const summary = await runLoad(
      async (_w, _s, seq) => {
        await clock.sleep(1);
        if (seq > 5) throw new Error("overloaded");
        return "ok";
      },
      {
        concurrency: 1,
        stages: {
          by: "concurrency",
          levels: [1, 1, 1],
          stageMs: 5,
          stopOnBreach: { maxErrorRate: 0.1 },
        },
      },
      clock,
    );
    expect(summary.stages).toHaveLength(2);
    expect(summary.stoppedEarly).toEqual({
      reason: "threshold_breached",
      detail: expect.stringMatching(
        /^stage 2 \(concurrency 1\) breached a threshold: error rate 1 /,
      ),
    });
  });

  it("ends the run with the stage that stopped early", async () => {
    const controller = new AbortController();
    const clock = fakeClock();
    const summary = await runLoad(
      async () => {
        await clock.sleep(1);
        controller.abort();
        return "ok";
      },
      {
        concurrency: 1,
        stages: { by: "concurrency", levels: [1, 1], stageMs: 50 },
      },
      clock,
      controller.signal,
    );
    expect(summary.stages).toHaveLength(1);
    expect(summary.stoppedEarly?.reason).toBe("interrupted");
  });

  it("totals a scenario's steps across stages", async () => {
    const clock = fakeClock();
    const summary = await runLoad(
      async () => {
        await clock.sleep(1);
        return "ok";
      },
      {
        concurrency: 1,
        scenario: validateLoadScenario([
          { method: "tools/call", tool: "a" },
          { method: "tools/call", tool: "b" },
        ]),
        stages: { by: "concurrency", levels: [1, 1], stageMs: 10 },
      },
      clock,
    );
    const perStage = summary.stages!.map((s) =>
      s.steps!.map((x) => x.requests),
    );
    expect(perStage).toEqual([
      [5, 5],
      [5, 5],
    ]);
    expect(summary.steps!.map((x) => x.requests)).toEqual([10, 10]);
  });
});

/** A finished two-stage summary, for the judging and warning tests. */
function staged(stages: Partial<LoadSummary>[]): LoadSummary {
  const base: LoadSummary = {
    concurrency: 1,
    requests: 10,
    ok: 10,
    toolErrors: 0,
    errors: 0,
    errorRate: 0,
    elapsedMs: 1000,
    throughput: 10,
    okThroughput: 10,
    latencyMs: { min: 1, mean: 1, p50: 1, p90: 1, p99: 1, max: 1 },
    errorLatencyMs: null,
    errorMessages: [],
    toolErrorMessages: [],
  };
  return {
    ...base,
    stages: stages.map((s, i) => ({
      stage: i + 1,
      stepBy: "concurrency" as const,
      level: (i + 1) * 10,
      ...base,
      ...s,
    })),
  };
}

describe("judging a stepped run", () => {
  it("names the first stage that breaches", () => {
    const summary = staged([
      {},
      {
        errors: 5,
        ok: 5,
        latencyMs: { min: 1, mean: 1, p50: 1, p90: 1, p99: 900, max: 900 },
      },
    ]);
    expect(() =>
      checkLoadThresholds(summary, { maxErrorRate: 0.1, maxP99Ms: 100 }),
    ).toThrow(
      expect.objectContaining({
        message:
          "Load threshold exceeded at stage 2 (concurrency 20): error rate 0 (5 of 10 calls failed) is above --load-max-error-rate 0.1; p99 latency 900ms is above --load-max-p99 100ms.",
        envelope: { code: "load_error_rate_exceeded" },
      }),
    );
  });

  it("passes when every stage holds", () => {
    expect(() =>
      checkLoadThresholds(staged([{}, {}]), { maxErrorRate: 0 }),
    ).not.toThrow();
  });

  it("reports breaches without throwing", () => {
    expect(loadThresholdBreaches(staged([]), { maxP99Ms: 0.5 })).toEqual([
      {
        code: "load_p99_exceeded",
        message: "p99 latency 1ms is above --load-max-p99 0.5ms",
      },
    ]);
    expect(loadThresholdBreaches(staged([]), {})).toEqual([]);
  });

  it("warns of a missed rate per stage", () => {
    const summary = staged([
      { rate: 10, plannedStarts: 100, droppedSlots: 50, achievedRate: 5 },
      { rate: 20, plannedStarts: 100, droppedSlots: 0, achievedRate: 20 },
    ]);
    const warnings = loadSummaryWarnings(summary);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^Stage 1: Warning: --load-rate 10\/s was not reached/,
    );
  });
});

describe("--load-steps / --load-ramp (CLI)", () => {
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

  it("prints one row per stage under the totals", async () => {
    const result = await runCli([
      ...echoLoad,
      "--load-steps",
      "1,2",
      "--load-step-duration",
      "0.2",
    ]);
    expectCliSuccess(result);
    const summary = expectValidJson(result) as LoadSummary;
    expect(
      summary.stages!.map((s) => [s.stage, s.level, s.durationMs]),
    ).toEqual([
      [1, 1, 200],
      [2, 2, 200],
    ]);
    expect(summary.requests).toBe(
      summary.stages!.reduce((n, s) => n + s.requests, 0),
    );
    expect(summary).toMatchObject({ concurrency: 2, durationMs: 400 });
  });

  it("runs a rate ramp", async () => {
    const result = await runCli([
      ...echoLoad,
      "--load-ramp",
      "10:20:0.4",
      "--load-step-duration",
      "0.2",
      "--load-step-by",
      "rate",
    ]);
    expectCliSuccess(result);
    const summary = expectValidJson(result) as LoadSummary;
    expect(summary.stages!.map((s) => [s.stepBy, s.level, s.rate])).toEqual([
      ["rate", 10, 10],
      ["rate", 20, 20],
    ]);
  });

  it("stops at the first breached stage and exits 10", async () => {
    const result = await runCli([
      ...echoLoad,
      "--load-steps",
      "1,1,1",
      "--load-step-duration",
      "0.1",
      "--load-max-p99",
      "0.000001",
      "--load-stop-on-breach",
    ]);
    expect(result.exitCode).toBe(10);
    const summary = expectValidJson(result) as LoadSummary;
    expect(summary.stages).toHaveLength(1);
    expect(summary.stoppedEarly?.reason).toBe("threshold_breached");
    expect(result.stderr).toContain(
      "Load threshold exceeded at stage 1 (concurrency 1)",
    );
  });

  it.each([
    [
      ["--load-steps", "1", "--load-duration", "1"],
      "--load-steps cannot be combined with --load-duration or --load-requests",
    ],
    [
      ["--load-step-by", "rate"],
      "--load-step-by requires --load-steps or --load-ramp.",
    ],
  ])("refuses %j", async (extra, message) => {
    const result = await runCli([...echoLoad, ...extra]);
    expectCliFailure(result);
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain("load_flag_conflict");
  });

  it("requires --load for the stage flags", async () => {
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--load-steps",
      "1",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toContain("--load-steps requires --load.");
  });
});
