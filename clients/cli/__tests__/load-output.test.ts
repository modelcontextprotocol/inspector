import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliFailure,
  expectCliSuccess,
  expectValidJson,
} from "./helpers/assertions.js";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import {
  resolveLoadOptions,
  runLoad,
  type LoadSample,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import { formatLoadSummaryHuman } from "@inspector/core/cli/handlers/load-format.js";
import { openLoadSampleFile } from "@inspector/core/cli/handlers/load-samples.js";
import { validateLoadScenario } from "@inspector/core/cli/handlers/load-scenario.js";
import { CliExitCodeError } from "@inspector/core/cli/error-handler.js";
import { createStyle, PLAIN } from "@inspector/core/cli/style.js";
import { fakeClock } from "./helpers/load-clock.js";

/**
 * #2838 items 5, 7 and 8: per-call samples for `--output`, the readable text
 * summary shared by both CLIs, and open-loop mode.
 */

describe("open loop (engine)", () => {
  it("keeps every slot and times each call from its scheduled start", async () => {
    const clock = fakeClock();
    const latencies: number[] = [];
    const summary = await runLoad(
      async () => {
        await clock.sleep(250);
        return "ok";
      },
      { concurrency: 1, durationMs: 1000, rate: 10, openLoop: true },
      clock,
      undefined,
      undefined,
      (s) => latencies.push(s.latencyMs),
    );
    // Slots every 100 ms; one worker taking 250 ms falls ever further behind,
    // and each call's wait for the worker counts in its latency.
    expect(latencies).toEqual([250, 400, 550, 700]);
    expect(summary).toMatchObject({
      openLoop: true,
      requests: 4,
      plannedStarts: 10,
      droppedSlots: 6,
    });
    expect(summary.latencyMs?.max).toBe(700);
  });

  it("drops missed slots and times from the start without it", async () => {
    const clock = fakeClock();
    const latencies: number[] = [];
    const summary = await runLoad(
      async () => {
        await clock.sleep(250);
        return "ok";
      },
      { concurrency: 1, durationMs: 1000, rate: 10 },
      clock,
      undefined,
      undefined,
      (s) => latencies.push(s.latencyMs),
    );
    expect(latencies.every((l) => l === 250)).toBe(true);
    expect(summary).not.toHaveProperty("openLoop");
  });

  it("needs a rate to follow", () => {
    expect(() => resolveLoadOptions({ openLoop: true })).toThrow(
      "--load-open-loop requires --load-rate (or --load-step-by rate).",
    );
    expect(resolveLoadOptions({ openLoop: true, rate: 5 })).toMatchObject({
      openLoop: true,
      rate: 5,
    });
    expect(
      resolveLoadOptions({
        openLoop: true,
        stages: { by: "rate", levels: [5], stageMs: 1000 },
      }),
    ).toMatchObject({ openLoop: true });
  });

  it("carries open loop into every stage", async () => {
    const clock = fakeClock();
    const summary = await runLoad(
      async () => {
        await clock.sleep(1);
        return "ok";
      },
      {
        concurrency: 1,
        openLoop: true,
        stages: { by: "rate", levels: [10, 20], stageMs: 200 },
      },
      clock,
    );
    expect(summary.stages!.every((s) => s.openLoop === true)).toBe(true);
  });
});

describe("per-call samples (engine)", () => {
  it("reports each measured call, its outcome and where it ran", async () => {
    const clock = fakeClock();
    const samples: LoadSample[] = [];
    let n = 0;
    await runLoad(
      async () => {
        n++;
        await clock.sleep(10);
        if (n === 2) return { outcome: "tool_error", message: "busy" };
        if (n === 3) return "tool_error";
        if (n === 4) throw new Error("boom");
        return "ok";
      },
      {
        concurrency: 1,
        requests: 4,
        scenario: validateLoadScenario([
          { method: "tools/call", tool: "a", name: "a" },
        ]),
      },
      clock,
      undefined,
      undefined,
      (s) => samples.push(s),
    );
    expect(samples).toEqual([
      {
        seq: 1,
        worker: 0,
        startMs: 0,
        latencyMs: 10,
        outcome: "ok",
        step: "a",
      },
      {
        seq: 2,
        worker: 0,
        startMs: 10,
        latencyMs: 10,
        outcome: "tool_error",
        message: "busy",
        step: "a",
      },
      {
        seq: 3,
        worker: 0,
        startMs: 20,
        latencyMs: 10,
        outcome: "tool_error",
        message: "(no text content)",
        step: "a",
      },
      {
        seq: 4,
        worker: 0,
        startMs: 30,
        latencyMs: 10,
        outcome: "error",
        message: "boom",
        step: "a",
      },
    ]);
  });

  it("labels stages and leaves the warm-up out", async () => {
    const clock = fakeClock();
    const staged: LoadSample[] = [];
    await runLoad(
      async () => {
        await clock.sleep(10);
        return "ok";
      },
      {
        concurrency: 1,
        stages: { by: "concurrency", levels: [1, 1], stageMs: 20 },
      },
      clock,
      undefined,
      undefined,
      (s) => staged.push(s),
    );
    expect(staged.map((s) => s.stage)).toEqual([1, 1, 2, 2]);
    const warmed: LoadSample[] = [];
    const summary = await runLoad(
      async () => {
        await clock.sleep(10);
        return "ok";
      },
      { concurrency: 1, durationMs: 20, warmupMs: 20 },
      clock,
      undefined,
      undefined,
      (s) => warmed.push(s),
    );
    expect(summary.warmup?.requests).toBe(2);
    expect(warmed.map((s) => s.seq)).toEqual([3, 4]);
  });
});

describe("openLoadSampleFile", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const sample: LoadSample = {
    seq: 1,
    worker: 0,
    startMs: 0,
    latencyMs: 1.5,
    outcome: "ok",
  };

  it("writes one JSON line per sample", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-samples-"));
    const file = path.join(dir, "out.ndjson");
    const out = openLoadSampleFile(file);
    out.write(sample);
    out.write({ ...sample, seq: 2 });
    await out.close();
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l).seq)).toEqual([1, 2]);
  });

  it("reports a file it cannot write as output_write_failed", async () => {
    const out = openLoadSampleFile(
      path.join(os.tmpdir(), "no-such-dir-2838", "x", "out.ndjson"),
    );
    out.write(sample);
    // Let the open fail before closing.
    await new Promise((r) => setTimeout(r, 20));
    out.write(sample);
    const err = await out.close().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CliExitCodeError);
    expect((err as CliExitCodeError).envelope?.code).toBe(
      "output_write_failed",
    );
  });

  it("fails on close when the open fails during the flush", async () => {
    const out = openLoadSampleFile(
      path.join(os.tmpdir(), "no-such-dir-2838", "y", "out.ndjson"),
    );
    await expect(out.close()).rejects.toMatchObject({
      envelope: { code: "output_write_failed" },
    });
  });
});

const LATENCY = {
  min: 1,
  mean: 2,
  p50: 2,
  p90: 3,
  p95: 3,
  p99: 4,
  p999: 4,
  max: 5,
};

const BASE: LoadSummary = {
  tool: "echo",
  concurrency: 2,
  requests: 10,
  ok: 10,
  toolErrors: 0,
  errors: 0,
  errorRate: 0,
  elapsedMs: 1000,
  throughput: 10,
  okThroughput: 10,
  latencyMs: LATENCY,
  errorLatencyMs: null,
  errorMessages: [],
  toolErrorMessages: [],
};

describe("formatLoadSummaryHuman", () => {
  it("renders a plain run's essentials", () => {
    expect(formatLoadSummaryHuman(BASE)).toBe(
      [
        "Load test `echo` (concurrency 2)",
        "  Requests:   10 in 1.00s (10/s, 10/s ok)",
        "  Outcomes:   10 ok, 0 tool errors, 0 errors",
        "  Error rate: 0.00%",
        "  Latency:    min 1 / mean 2 / p50 2 / p90 3 / p95 3 / p99 4 / p99.9 4 / max 5 ms",
      ].join("\n"),
    );
  });

  it("renders every optional section", () => {
    const text = formatLoadSummaryHuman(
      {
        ...BASE,
        tool: undefined,
        durationMs: 1500,
        requestLimit: 40,
        rate: 20,
        openLoop: true,
        plannedStarts: 30,
        droppedSlots: 2,
        achievedRate: 18.67,
        toolErrors: 1,
        errors: 2,
        errorRate: 0.3,
        latencyMs: null,
        errorLatencyMs: LATENCY,
        errorMessages: [{ message: "Request timed out", count: 2 }],
        toolErrorMessages: [{ message: "busy", count: 1 }],
        stoppedEarly: { reason: "consecutive_errors", detail: "gone" },
        warmup: {
          durationMs: 2000,
          requests: 4,
          ok: 3,
          failed: 1,
          stoppedEarly: { reason: "interrupted", detail: "x" },
        },
        intervals: [
          { ...BASE, startMs: 0, endMs: 500 },
          { ...BASE, startMs: 500, endMs: 1000, latencyMs: null },
        ],
        stages: [
          {
            ...BASE,
            stage: 1,
            stepBy: "rate",
            level: 20,
            achievedRate: 19,
            stoppedEarly: { reason: "threshold_breached", detail: "y" },
            intervals: [{ ...BASE, startMs: 0, endMs: 500 }],
          },
          {
            ...BASE,
            stage: 2,
            stepBy: "concurrency",
            level: 4,
            latencyMs: null,
          },
        ],
        steps: [
          {
            ...BASE,
            name: "search",
            method: "tools/call",
            target: "search",
            weight: 3,
            errors: 1,
            errorMessages: [{ message: "boom", count: 1 }],
          },
          {
            ...BASE,
            name: "doc",
            method: "resources/read",
            target: "doc://x",
            weight: 1,
            latencyMs: null,
          },
        ],
        connections: {
          requested: 3,
          opened: 2,
          failed: 1,
          connectMs: LATENCY,
          errorMessages: [{ message: "refused", count: 1 }],
        },
      },
      PLAIN,
    );
    for (const line of [
      "Load test scenario (2 steps) (concurrency 2, duration 1.5s, limit 40, rate 20/s, open loop)",
      "  Error rate: 30.00%",
      "  Rate:       18.67/s achieved; 30 planned, 2 dropped",
      "  Latency:    no calls succeeded",
      "  Failed in:  min 1 / mean 2 / p50 2 / p90 3 / p95 3 / p99 4 / p99.9 4 / max 5 ms",
      "  Top errors:\n    2× Request timed out",
      "  Top tool errors:\n    1× busy",
      "  Stopped early (consecutive_errors): gone",
      "  Warm-up:    2s, 4 calls excluded (3 ok, 1 failed) (stopped: interrupted)",
      "  Intervals:\n    0–0.5s: 10 calls (10/s), 0 failed; p50 2 / p99 4 ms\n    0.5–1s: 10 calls (10/s), 0 failed; no successes",
      "    1. rate 20/s: 10 requests (10/s ok, 19/s started), 0.00% errors; p50 2 / p99 4 ms (stopped: threshold_breached)\n      0–0.5s: 10 calls",
      "    2. concurrency 4: 10 requests (10/s ok), 0.00% errors; no calls succeeded",
      "    `search` (tools/call search, weight 3)",
      "      10 requests (10/s): 10 ok, 0 tool errors, 1 errors (0.00%); p50 2 / p99 4 ms\n      1× boom",
      "      10 requests (10/s): 10 ok, 0 tool errors, 0 errors (0.00%); no calls succeeded",
      "  Sessions:   2 of 3 opened, 1 failed (connect p50 2 / max 5 ms)\n    1× refused",
    ]) {
      expect(text).toContain(line);
    }
  });

  it("handles a one-step scenario, no rate shortfall and no connect times", () => {
    const text = formatLoadSummaryHuman({
      ...BASE,
      tool: undefined,
      rate: 5,
      plannedStarts: 5,
      droppedSlots: 0,
      achievedRate: 5,
      steps: [
        {
          ...BASE,
          name: "p",
          method: "prompts/get",
          target: "p",
          weight: 1,
        },
      ],
      connections: {
        requested: 2,
        opened: 2,
        failed: 0,
        connectMs: null,
        errorMessages: [],
      },
    });
    expect(text).toMatch(/^Load test scenario \(1 step\)/);
    expect(text).toContain("5 planned, 0 dropped");
    expect(text).toContain("  Sessions:   2 of 2 opened, 0 failed");
    expect(text).not.toContain("connect p50");
  });

  it("colors failures when styled", () => {
    const text = formatLoadSummaryHuman(
      {
        ...BASE,
        errors: 1,
        errorRate: 0.1,
        plannedStarts: 10,
        droppedSlots: 1,
        achievedRate: 9,
        rate: 10,
        stages: [{ ...BASE, stage: 1, stepBy: "rate", level: 1, errors: 1 }],
        steps: [
          {
            ...BASE,
            name: "s",
            method: "tools/call",
            target: "s",
            weight: 1,
            errors: 1,
          },
        ],
        connections: {
          requested: 2,
          opened: 1,
          failed: 1,
          connectMs: null,
          errorMessages: [],
        },
      },
      createStyle(true),
    );
    // Red (31) wraps the error rate, the dropped slots and the failures.
    expect(text).toContain("\u001b[31m10.00%\u001b[39m");
    expect(text).toContain("\u001b[31m1 dropped\u001b[39m");
    expect(text).toContain("\u001b[31m1 failed\u001b[39m");
  });
});

describe("--load output, text and open loop (CLI)", () => {
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
    "6",
  ];
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("prints the readable summary with --format text", async () => {
    const result = await runCli([...echoLoad, "--format", "text"]);
    expectCliSuccess(result);
    expect(result.stdout).toMatch(/^Load test `echo` \(concurrency 10/);
    expect(result.stdout).toContain("  Outcomes:   6 ok");
  });

  it("keeps the JSON summary when piped without --format", async () => {
    const result = await runCli(echoLoad);
    expectCliSuccess(result);
    expect(expectValidJson(result)).toMatchObject({ requests: 6 });
  });

  it("writes one NDJSON line per call with --output", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-output-e2e-"));
    const file = path.join(dir, "calls.ndjson");
    const result = await runCli([...echoLoad, "--output", file]);
    expectCliSuccess(result);
    expect(expectValidJson(result)).toMatchObject({ requests: 6 });
    const lines = fs
      .readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as LoadSample);
    expect(lines).toHaveLength(6);
    expect(lines.map((l) => l.seq).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(lines.every((l) => l.outcome === "ok")).toBe(true);
  });

  it("fails with output_write_failed after the summary when the file cannot be written", async () => {
    const result = await runCli([
      ...echoLoad,
      "--output",
      path.join(os.tmpdir(), "no-such-dir-2838", "calls.ndjson"),
    ]);
    expect(result.exitCode).toBe(1);
    expect(expectValidJson(result)).toMatchObject({ requests: 6 });
    expect(result.stderr).toContain("output_write_failed");
  });

  it("closes the sample file when the run itself fails", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-output-e2e-"));
    const file = path.join(dir, "calls.ndjson");
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      "no_such_tool",
      "--load",
      "--output",
      file,
    ]);
    expect(result.exitCode).toBe(5);
    expect(fs.readFileSync(file, "utf8")).toBe("");
  });

  it("runs open loop and refuses it without a rate", async () => {
    const ok = await runCli([
      ...echoLoad,
      "--load-rate",
      "50",
      "--load-open-loop",
    ]);
    expectCliSuccess(ok);
    expect(expectValidJson(ok)).toMatchObject({ openLoop: true, rate: 50 });
    const refused = await runCli([...echoLoad, "--load-open-loop"]);
    expectCliFailure(refused);
    expect(refused.stderr).toContain("--load-open-loop requires --load-rate");
  });

  it("requires --load for --load-open-loop", async () => {
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--load-open-loop",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toContain("--load-open-loop requires --load.");
  });
});
