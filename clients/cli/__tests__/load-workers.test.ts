import { describe, it, expect } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { z } from "zod";
import {
  createTestServerHttp,
  createTestServerInfo,
  getTestMcpServerCommand,
} from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import { fakeClock } from "./helpers/load-clock.js";
import { expectCliSuccess, expectValidJson } from "./helpers/assertions.js";
import {
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/core/cli/error-handler.js";
import {
  ErrorTally,
  OutcomeStats,
  resolveLoadOptions,
  runLoad,
  shardContext,
  type LoadOptions,
  type LoadProgress,
  type LoadRawStats,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import { LatencyRecorder } from "@inspector/core/cli/handlers/load-latency.js";
import { loadArgsTemplate } from "@inspector/core/cli/handlers/load-template.js";
import { formatLoadSummaryHuman } from "@inspector/core/cli/handlers/load-format.js";
import {
  LOAD_WORKER_ENTRY_ENV,
  LOAD_WORKER_ENV,
  mergeLoadProgress,
  mergeLoadWorkerResults,
  processWorkerPort,
  readLoadShard,
  runAsLoadWorker,
  runLoadWorkers,
  shardLoadOptions,
  workerArgv,
  type LoadWorkerCommand,
  type LoadWorkerHandle,
  type LoadWorkerMessage,
  type IpcProcess,
  type LoadWorkerPort,
} from "@inspector/core/cli/handlers/load-workers.js";

/** `--load-workers` (#2914): a multi-process load generator. */

const BIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../build/index.js",
);

/** A recorder fed `values`. */
function recorder(values: number[], exactLimit?: number): LatencyRecorder {
  const r = new LatencyRecorder(exactLimit);
  for (const v of values) r.add(v);
  return r;
}

const spread = (n: number, from = 1): number[] =>
  Array.from({ length: n }, (_, i) => from + ((i * 7919) % 1000) / 10);

describe("LatencyRecorder.merge", () => {
  it("is exact while the samples are", () => {
    const a = spread(50);
    const b = spread(70, 3);
    const merged = recorder(a);
    merged.merge(recorder(b).snapshot());
    expect(merged.summarize()).toEqual(recorder([...a, ...b]).summarize());
  });

  it("matches one recorder once either side, or the total, is a histogram", () => {
    const a = spread(30);
    const b = spread(40, 2);
    const one = recorder([...a, ...b], 50).summarize();
    // Total past the limit; one side past it; the other side past it; both.
    for (const [x, y] of [
      [recorder(a, 50), recorder(b, 50)],
      [recorder([...a, ...a], 50), recorder(b, 50)],
      [recorder(a, 50), recorder([...b, ...b], 50)],
    ] as const) {
      x.merge(y.snapshot());
      expect(x.summarize()).not.toBeNull();
    }
    const left = recorder(a, 50);
    left.merge(recorder(b, 50).snapshot());
    expect(left.summarize()).toEqual(one);
    const big = recorder([...a, ...b, ...a], 50);
    const parts = recorder(a, 50);
    parts.merge(recorder([...b, ...a], 50).snapshot());
    expect(parts.summarize()).toEqual(big.summarize());
    const histograms = recorder([...a, ...b], 50);
    histograms.merge(recorder([...b, ...a], 50).snapshot());
    expect(histograms.summarize()).toEqual(
      recorder([...a, ...b, ...b, ...a], 50).summarize(),
    );
    const fromExact = recorder([...a, ...b], 50);
    fromExact.merge(recorder([1, 2], 50).snapshot());
    expect(fromExact.summarize()).toEqual(
      recorder([...a, ...b, 1, 2], 50).summarize(),
    );
  });

  it("ignores an empty side", () => {
    const r = recorder([5]);
    r.merge(new LatencyRecorder().snapshot());
    expect(r.summarize()).toEqual(recorder([5]).summarize());
  });
});

describe("ErrorTally and OutcomeStats merge", () => {
  it("adds counts under the same cap", () => {
    const a = new ErrorTally();
    const b = new ErrorTally();
    for (let i = 0; i < 10; i++) a.add(`a${i}`);
    a.add("shared");
    b.add("a0");
    b.add("b");
    b.add("b");
    a.merge(b.snapshot());
    const entries = a.entries();
    expect(entries.find((e) => e.message === "a0")?.count).toBe(2);
    expect(entries.at(-1)).toEqual({ message: "(other)", count: 3 });
  });

  it("merges outcome counts, latencies and tallies", () => {
    const a = new OutcomeStats();
    const b = new OutcomeStats();
    a.addResult("ok", 1);
    b.addResult("ok", 3);
    b.addResult({ outcome: "tool_error", message: "nope" }, 2);
    b.addThrown("boom", 4);
    a.merge(b.snapshot());
    expect(a.summarize(1000)).toMatchObject({
      requests: 4,
      ok: 2,
      toolErrors: 1,
      errors: 1,
      latencyMs: { min: 1, max: 3 },
      errorMessages: [{ message: "boom", count: 1 }],
      toolErrorMessages: [{ message: "nope", count: 1 }],
    });
  });
});

describe("sharding", () => {
  it("reads its shard from the environment", () => {
    expect(readLoadShard({ [LOAD_WORKER_ENV]: "1/3" })).toEqual({
      index: 1,
      count: 3,
    });
    expect(readLoadShard({})).toBeUndefined();
    expect(readLoadShard({ [LOAD_WORKER_ENV]: "3/3" })).toBeUndefined();
    expect(readLoadShard({ [LOAD_WORKER_ENV]: "x" })).toBeUndefined();
  });

  it("splits concurrency, requests and rate as evenly as integers allow", () => {
    const options: LoadOptions = {
      concurrency: 10,
      requests: 7,
      rate: 30,
      durationMs: 5000,
      workers: 3,
    };
    const shards = [0, 1, 2].map((i) => shardLoadOptions(options, i, 3));
    expect(shards.map((s) => s.concurrency)).toEqual([4, 3, 3]);
    expect(shards.map((s) => s.requests)).toEqual([3, 2, 2]);
    expect(shards.map((s) => s.rate)).toEqual([10, 10, 10]);
    expect(shards[1]).toMatchObject({
      durationMs: 5000,
      shard: { index: 1, count: 3 },
    });
    expect(shards[0]).not.toHaveProperty("workers");
    expect(
      shardLoadOptions({ concurrency: 4, durationMs: 1 }, 0, 2),
    ).not.toHaveProperty("requests");
  });

  it("keeps seq and worker unique across shards", () => {
    expect(shardContext(3, 1, undefined)).toEqual({ seq: 3, worker: 1 });
    const seen = new Set<number>();
    const workers = new Set<number>();
    for (let index = 0; index < 3; index++) {
      for (let seq = 1; seq <= 4; seq++) {
        seen.add(shardContext(seq, 0, { index, count: 3 }).seq);
      }
      for (let w = 0; w < 2; w++) {
        workers.add(shardContext(1, w, { index, count: 3 }).worker);
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(workers.size).toBe(6);
  });

  it("drops --load-workers and the parent's re-login from a worker's arguments", () => {
    expect(
      workerArgv([
        "--cli",
        "--load-workers",
        "4",
        "--relogin",
        "--no-revoke",
        "--load",
        "--load-workers=2",
      ]),
    ).toEqual(["--cli", "--load"]);
  });

  it("keeps each process's own mix whatever the steps cost", async () => {
    const scenario = {
      steps: [
        { name: "a", method: "tools/call" as const, tool: "echo", weight: 1 },
        { name: "b", method: "tools/call" as const, tool: "echo", weight: 1 },
      ],
    };
    const options: LoadOptions = { concurrency: 2, durationMs: 1000, scenario };
    for (const i of [0, 1]) {
      const clock = fakeClock();
      const counts = [0, 0];
      await runLoad(
        async (_w, step) => {
          counts[step]!++;
          // A costs 1 ms, B 100 ms.
          await clock.sleep(step === 0 ? 1 : 100);
          return "ok";
        },
        shardLoadOptions(options, i, 2),
        clock,
      );
      // Started in turn, so neither step is starved by the other's cost.
      expect(Math.abs(counts[0]! - counts[1]!)).toBeLessThanOrEqual(1);
      expect(counts[1]).toBeGreaterThan(1);
    }
  });

  it("interleaves the processes' rate grids instead of bursting", async () => {
    const options: LoadOptions = { concurrency: 4, durationMs: 1000, rate: 1 };
    let started = 0;
    for (const i of [0, 1, 2, 3]) {
      await runLoad(
        async () => {
          started++;
          return "ok";
        },
        shardLoadOptions(options, i, 4),
        fakeClock(),
      );
    }
    // One call a second for one second: one call, not one per process.
    expect(started).toBe(1);
  });

  it("reports the merged rate over the run's window, not each grid's", async () => {
    const options: LoadOptions = { concurrency: 4, durationMs: 1000, rate: 4 };
    const results = [];
    for (const i of [0, 1, 2, 3]) {
      results.push(await workerResultOn(shardLoadOptions(options, i, 4)));
    }
    const merged = mergeLoadWorkerResults(results, options);
    expect(merged.requests).toBe(4);
    expect(merged.achievedRate).toBe(4);
    expect(merged.droppedSlots).toBe(0);
  });

  it("reports a request-capped run's rate over one window too", async () => {
    // Each worker's own window ends at 1, 1.25, 1.5 and 1.75 s; the run's
    // schedule (0, 0.25, 0.5, 0.75 s) ends at 1 s.
    const options: LoadOptions = { concurrency: 4, requests: 4, rate: 4 };
    const results = [];
    for (const i of [0, 1, 2, 3]) {
      results.push(await workerResultOn(shardLoadOptions(options, i, 4)));
    }
    const merged = mergeLoadWorkerResults(results, options);
    expect(merged).toMatchObject({ requests: 4, achievedRate: 4 });
  });

  it("cycles every argument row in every process", () => {
    const rows = loadArgsTemplate(
      {},
      { rows: [{ v: "fast" }, { v: "slow" }], order: "sequential" },
    );
    const used = [1, 2].map(
      (seq) => rows(shardContext(seq, 0, { index: 0, count: 2 })).v,
    );
    expect(used).toEqual(["fast", "slow"]);
  });

  it("gives the processes together the mix one picker would", async () => {
    const scenario = {
      steps: [
        { name: "a", method: "tools/call" as const, tool: "echo", weight: 1 },
        { name: "b", method: "tools/call" as const, tool: "echo", weight: 1 },
      ],
    };
    const options: LoadOptions = { concurrency: 2, requests: 2, scenario };
    const steps: number[] = [];
    for (const i of [0, 1]) {
      await runLoad(
        async (_w, step) => {
          steps.push(step);
          return "ok";
        },
        shardLoadOptions(options, i, 2),
      );
    }
    expect(steps.sort()).toEqual([0, 1]);
  });

  it.each([
    [
      { workers: 2, stages: { by: "rate" as const, levels: [1], stageMs: 1 } },
      "--load-steps or --load-ramp",
    ],
    [{ workers: 2, intervalSec: 1 }, "--load-interval"],
    [{ workers: 2, connections: 2 }, "--load-connections"],
    [{ workers: 2, churn: true }, "--load-churn"],
    [
      { workers: 2, subscribe: "x://y", concurrency: 1 },
      "--load-workers cannot be combined with --load-subscribe.",
    ],
  ])("refuses %j", (flags, conflict) => {
    expect(() => resolveLoadOptions(flags)).toThrow(conflict);
  });

  it("needs a call in flight and a call to make for every worker", () => {
    expect(() => resolveLoadOptions({ workers: 4, concurrency: 3 })).toThrow(
      "--load-workers (4) cannot exceed --load-concurrency (3)",
    );
    expect(() => resolveLoadOptions({ workers: 4, requests: 3 })).toThrow(
      "--load-workers (4) cannot exceed --load-requests (3)",
    );
    expect(resolveLoadOptions({ workers: 4, requests: 8 }).workers).toBe(4);
    expect(resolveLoadOptions({ workers: 1, requests: 8 })).not.toHaveProperty(
      "workers",
    );
  });
});

/** A worker's result: a real engine run of `calls` instant calls. */
async function workerResult(
  options: LoadOptions,
  outcome: "ok" | "throw" = "ok",
): Promise<{ summary: LoadSummary; raw: LoadRawStats }> {
  let raw: LoadRawStats | undefined;
  const summary = await runLoad(
    async () => {
      if (outcome === "throw") throw new Error("down");
      return "ok";
    },
    options,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      raw: (r) => {
        raw = r;
      },
    },
  );
  return { summary: { tool: "echo", ...summary }, raw: raw! };
}

/** {@link workerResult} on the fake clock, with instant calls. */
async function workerResultOn(
  options: LoadOptions,
): Promise<{ summary: LoadSummary; raw: LoadRawStats }> {
  let raw: LoadRawStats | undefined;
  const summary = await runLoad(
    async () => "ok",
    options,
    fakeClock(),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      raw: (r) => {
        raw = r;
      },
    },
  );
  return { summary, raw: raw! };
}

describe("mergeLoadWorkerResults", () => {
  it("adds the counts and keeps the run's own shape", async () => {
    const options: LoadOptions = { concurrency: 4, requests: 10, rate: 1000 };
    const results = await Promise.all(
      [0, 1].map((i) => workerResult(shardLoadOptions(options, i, 2))),
    );
    const merged = mergeLoadWorkerResults(results, options);
    expect(merged).toMatchObject({
      tool: "echo",
      concurrency: 4,
      requestLimit: 10,
      rate: 1000,
      requests: 10,
      ok: 10,
      workers: 2,
    });
    expect(merged.plannedStarts).toBe(
      results[0]!.summary.plannedStarts! + results[1]!.summary.plannedStarts!,
    );
    expect(merged.elapsedMs).toBeGreaterThanOrEqual(
      Math.max(...results.map((r) => r.summary.elapsedMs)) - 0.01,
    );
  });

  it("merges scenario steps, warm-ups and the stop to report", async () => {
    const scenario = {
      steps: [
        { name: "a", method: "tools/call" as const, tool: "echo", weight: 1 },
        { name: "b", method: "tools/call" as const, tool: "echo", weight: 1 },
      ],
    };
    const options: LoadOptions = {
      concurrency: 2,
      durationMs: 20,
      warmupMs: 5,
      scenario,
      openLoop: false,
    };
    const results = await Promise.all(
      [0, 1].map((i) => workerResult(shardLoadOptions(options, i, 2))),
    );
    results[0]!.summary.stoppedEarly = {
      reason: "consecutive_errors",
      detail: "x",
    };
    results[1]!.summary.stoppedEarly = { reason: "interrupted", detail: "y" };
    results[1]!.summary.warmup!.stoppedEarly = {
      reason: "interrupted",
      detail: "y",
    };
    const merged = mergeLoadWorkerResults(results, options);
    expect(merged.steps!.map((s) => s.name)).toEqual(["a", "b"]);
    expect(merged.steps![0]!.requests + merged.steps![1]!.requests).toBe(
      merged.requests,
    );
    expect(merged.warmup!.requests).toBe(
      results[0]!.summary.warmup!.requests +
        results[1]!.summary.warmup!.requests,
    );
    expect(merged.warmup!.stoppedEarly?.reason).toBe("interrupted");
    expect(merged.stoppedEarly?.reason).toBe("interrupted");
    expect(merged).not.toHaveProperty("rate");
  });

  it("reads as worker processes in the text summary", async () => {
    const options: LoadOptions = { concurrency: 2, requests: 2 };
    const results = await Promise.all(
      [0, 1].map((i) => workerResult(shardLoadOptions(options, i, 2))),
    );
    expect(
      formatLoadSummaryHuman(mergeLoadWorkerResults(results, options)),
    ).toContain("2 worker processes");
  });
});

describe("mergeLoadProgress", () => {
  const p = (over: Partial<LoadProgress>): LoadProgress => ({
    phase: "run",
    elapsedMs: 1000,
    requests: 10,
    ok: 9,
    failed: 1,
    throughput: 10,
    latencyMs: { p50: 1, p99: 2 },
    ...over,
  });

  it("adds counts and takes the slowest worker's latency", () => {
    expect(
      mergeLoadProgress([
        p({}),
        p({ elapsedMs: 1200, latencyMs: { p50: 3, p99: 1 } }),
        undefined,
      ]),
    ).toEqual({
      phase: "run",
      elapsedMs: 1200,
      requests: 20,
      ok: 18,
      failed: 2,
      throughput: 20,
      latencyMs: { p50: 3, p99: 2 },
    });
    expect(
      mergeLoadProgress([p({ phase: "warmup", latencyMs: null })]),
    ).toMatchObject({ phase: "warmup", latencyMs: null });
    expect(mergeLoadProgress([undefined])).toBeUndefined();
  });
});

/** A worker that reports what the test says, when the test says. */
function fakeWorker() {
  const listeners: ((m: LoadWorkerMessage) => void)[] = [];
  const commands: LoadWorkerCommand[] = [];
  let exit!: (code: number | null) => void;
  const handle: LoadWorkerHandle = {
    onMessage: (l) => listeners.push(l),
    send: (c) => commands.push(c),
    exited: new Promise((r) => (exit = r)),
  };
  return {
    handle,
    commands,
    say: (m: LoadWorkerMessage) => listeners.forEach((l) => l(m)),
    exit: (code: number | null) => exit(code),
  };
}

describe("runLoadWorkers", () => {
  const options: LoadOptions = { concurrency: 2, requests: 4 };

  it("merges every worker's result, relaying progress", async () => {
    const workers = [fakeWorker(), fakeWorker()];
    const emitted: LoadProgress[] = [];
    const running = runLoadWorkers(2, (i) => workers[i]!.handle, options, {
      progress: { everyMs: 5, emit: (pr) => emitted.push(pr) },
    });
    const results = await Promise.all(
      [0, 1].map((i) => workerResult(shardLoadOptions(options, i, 2))),
    );
    workers.forEach((w, i) => {
      w.say({
        type: "progress",
        progress: {
          phase: "run",
          elapsedMs: 1,
          requests: 1,
          ok: 1,
          failed: 0,
          throughput: 1,
          latencyMs: null,
        },
      });
      w.say({ type: "result", ...results[i]! });
    });
    await new Promise((r) => setTimeout(r, 20));
    workers.forEach((w) => w.exit(0));
    const merged = await running;
    expect(merged).toMatchObject({ requests: 4, workers: 2 });
    expect(emitted[0]).toMatchObject({ requests: 2 });
    expect(workers.every((w) => w.commands.length === 0)).toBe(true);
  });

  it("stops the rest when one worker stops early", async () => {
    const workers = [fakeWorker(), fakeWorker()];
    const running = runLoadWorkers(2, (i) => workers[i]!.handle, options);
    const down = await workerResult(shardLoadOptions(options, 0, 2));
    const stop = { reason: "consecutive_errors" as const, detail: "gone" };
    workers[0]!.say({
      type: "result",
      summary: { ...down.summary, stoppedEarly: stop },
      raw: down.raw,
    });
    expect(workers[1]!.commands).toEqual([{ type: "stop", stop }]);
    expect(workers[0]!.commands).toEqual([]);
    const other = await workerResult(shardLoadOptions(options, 1, 2));
    workers[1]!.say({ type: "result", ...other });
    workers.forEach((w) => w.exit(0));
    expect((await running).stoppedEarly).toEqual(stop);
  });

  it("relays a worker's stop as it happens, before its result", async () => {
    const workers = [fakeWorker(), fakeWorker()];
    const running = runLoadWorkers(2, (i) => workers[i]!.handle, options);
    const stop = { reason: "consecutive_errors" as const, detail: "gone" };
    workers[0]!.say({ type: "stopped", stop });
    expect(workers[0]!.commands).toEqual([{ type: "stop", stop }]);
    expect(workers[1]!.commands).toEqual([{ type: "stop", stop }]);
    const results = await Promise.all(
      [0, 1].map((i) => workerResult(shardLoadOptions(options, i, 2))),
    );
    workers.forEach((w, i) => w.say({ type: "result", ...results[i]! }));
    workers.forEach((w) => w.exit(0));
    await running;
  });

  it("reports the parent's interrupt over a worker's earlier stop", async () => {
    const workers = [fakeWorker(), fakeWorker()];
    const ac = new AbortController();
    const running = runLoadWorkers(2, (i) => workers[i]!.handle, options, {
      signal: ac.signal,
    });
    const breaker = { reason: "consecutive_errors" as const, detail: "gone" };
    workers[0]!.say({ type: "stopped", stop: breaker });
    ac.abort();
    // Not latched behind the breaker's stop.
    expect(workers[1]!.commands.at(-1)).toMatchObject({
      stop: { reason: "interrupted" },
    });
    const results = await Promise.all(
      [0, 1].map((i) => workerResult(shardLoadOptions(options, i, 2))),
    );
    workers[0]!.say({
      type: "result",
      summary: { ...results[0]!.summary, stoppedEarly: breaker },
      raw: results[0]!.raw,
    });
    workers[1]!.say({ type: "result", ...results[1]! });
    workers.forEach((w) => w.exit(0));
    expect((await running).stoppedEarly?.reason).toBe("interrupted");
  });

  it("forwards an interrupt to every worker", async () => {
    const workers = [fakeWorker(), fakeWorker()];
    const ac = new AbortController();
    const running = runLoadWorkers(2, (i) => workers[i]!.handle, options, {
      signal: ac.signal,
    });
    ac.abort();
    for (const w of workers) {
      expect(w.commands[0]).toMatchObject({
        type: "stop",
        stop: { reason: "interrupted" },
      });
    }
    const results = await Promise.all(
      [0, 1].map((i) => workerResult(shardLoadOptions(options, i, 2))),
    );
    workers.forEach((w, i) => w.say({ type: "result", ...results[i]! }));
    workers.forEach((w) => w.exit(0));
    await running;

    // Already aborted before it started: stopped at once.
    const late = fakeWorker();
    const done = runLoadWorkers(1, () => late.handle, options, {
      signal: ac.signal,
    });
    expect(late.commands).toHaveLength(1);
    late.say({ type: "result", ...results[0]! });
    late.exit(0);
    await done;
  });

  it("fails with a worker's exit code when it never reports", async () => {
    const workers = [fakeWorker(), fakeWorker()];
    const running = runLoadWorkers(2, (i) => workers[i]!.handle, options);
    workers[0]!.exit(5);
    await new Promise((r) => setImmediate(r));
    expect(workers[1]!.commands[0]).toMatchObject({
      stop: { reason: "interrupted", detail: "load worker 0 failed" },
    });
    workers[1]!.exit(130);
    const err = await running.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliExitCodeError);
    expect((err as CliExitCodeError).exitCode).toBe(5);
    expect((err as CliExitCodeError).message).toBe(
      "--load-workers: worker 0 exited with code 5 before reporting its results.",
    );

    // A worker that could not even start reports no code: a usage failure.
    const broken = fakeWorker();
    const run2 = runLoadWorkers(1, () => broken.handle, options);
    broken.exit(null);
    const err2 = (await run2.catch((e: unknown) => e)) as CliExitCodeError;
    expect(err2.exitCode).toBe(EXIT_CODES.USAGE);
    expect(err2.message).toBe(
      "--load-workers: worker 0 exited before reporting its results.",
    );
  });
});

describe("runAsLoadWorker", () => {
  function fakePort() {
    const sent: LoadWorkerMessage[] = [];
    let listener: ((c: LoadWorkerCommand) => void) | undefined;
    const port: LoadWorkerPort = {
      send: async (m) => {
        sent.push(m);
      },
      onCommand: (l) => {
        listener = l;
        return () => (listener = undefined);
      },
    };
    return {
      port,
      sent,
      command: (c: LoadWorkerCommand) => listener?.(c),
      listening: () => listener !== undefined,
    };
  }

  it("runs, relays progress, and sends its summary with its raw stats", async () => {
    const { port, sent, command, listening } = fakePort();
    await runAsLoadWorker(port, async ({ signal, progress, observe }) => {
      progress({
        phase: "run",
        elapsedMs: 1,
        requests: 1,
        ok: 1,
        failed: 0,
        throughput: 1,
        latencyMs: null,
      });
      command({
        type: "stop",
        stop: { reason: "consecutive_errors", detail: "x" },
      });
      expect(signal.reason).toEqual({
        reason: "consecutive_errors",
        detail: "x",
      });
      // Stopped by the parent: no echo back.
      observe.stop!({ reason: "consecutive_errors", detail: "x" });
      const r = await workerResult({ concurrency: 1, requests: 1 });
      observe.raw!(r.raw);
      return r.summary;
    });
    expect(sent.map((m) => m.type)).toEqual(["progress", "result"]);
    expect(listening()).toBe(false);
  });

  it("swallows a failed progress send", async () => {
    const port: LoadWorkerPort = {
      send: async (m) => {
        if (m.type === "progress") throw new Error("pipe closed");
      },
      onCommand: () => () => {},
    };
    await runAsLoadWorker(port, async ({ progress, observe }) => {
      progress({
        phase: "run",
        elapsedMs: 1,
        requests: 0,
        ok: 0,
        failed: 0,
        throughput: 0,
        latencyMs: null,
      });
      const r = await workerResult({ concurrency: 1, requests: 1 });
      observe.raw!(r.raw);
      return r.summary;
    });
  });

  it("tells the parent at once when its own run stops early", async () => {
    const { port, sent } = fakePort();
    await runAsLoadWorker(port, async ({ signal, observe }) =>
      runLoad(
        async () => {
          throw new Error("down");
        },
        { concurrency: 1, durationMs: 60_000 },
        undefined,
        signal,
        undefined,
        undefined,
        undefined,
        observe,
      ),
    );
    expect(sent.map((m) => m.type)).toEqual(["stopped", "result"]);
    expect(sent[0]).toMatchObject({ stop: { reason: "consecutive_errors" } });
  });
});

describe("processWorkerPort", () => {
  it("sends over the process's IPC channel and hears its commands", async () => {
    const sent: unknown[] = [];
    const events = new EventEmitter();
    // A minimal IPC channel: Node's `send` calls back once written.
    let fail = false;
    const proc: IpcProcess = {
      send: (message, _h, _o, cb) => {
        sent.push(message);
        cb(fail ? new Error("channel closed") : null);
        return !fail;
      },
      on: (event, listener) => events.on(event, listener),
      off: (event, listener) => events.off(event, listener),
    };
    const port = processWorkerPort(proc);
    await port.send({
      type: "progress",
      progress: {
        phase: "run",
        elapsedMs: 0,
        requests: 0,
        ok: 0,
        failed: 0,
        throughput: 0,
        latencyMs: null,
      },
    });
    expect(sent).toHaveLength(1);
    const heard: LoadWorkerCommand[] = [];
    const off = port.onCommand((c) => heard.push(c));
    events.emit("message", {
      type: "stop",
      stop: { reason: "interrupted", detail: "" },
    });
    off();
    events.emit("message", {
      type: "stop",
      stop: { reason: "interrupted", detail: "" },
    });
    expect(heard).toHaveLength(1);

    fail = true;
    await expect(
      port.send({
        type: "result",
        summary: {} as LoadSummary,
        raw: {} as LoadRawStats,
      }),
    ).rejects.toThrow("channel closed");
  });

  it("refuses to send without an IPC channel", async () => {
    const events = new EventEmitter();
    const proc: IpcProcess = {
      on: (event, listener) => events.on(event, listener),
      off: (event, listener) => events.off(event, listener),
    };
    await expect(
      processWorkerPort(proc).send({
        type: "result",
        summary: {} as LoadSummary,
        raw: {} as LoadRawStats,
      }),
    ).rejects.toThrow("load worker has no IPC channel to its parent");
  });
});

describe("--load-workers (CLI)", () => {
  it("spreads a run over worker processes and merges one summary", async () => {
    const seqs: string[] = [];
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("load-workers", "1.0.0"),
      tools: [
        {
          name: "ping",
          description: "Records its argument",
          inputSchema: { n: z.number() },
          handler: async (params) => {
            seqs.push(String(params.n));
            return { content: [{ type: "text", text: "pong" }] };
          },
        },
      ],
    });
    try {
      await server.start();
      const result = await runCli(
        [
          "node",
          "cli",
          server.url,
          "--cli",
          "--transport",
          "http",
          "--method",
          "tools/call",
          "--tool-name",
          "ping",
          "--tool-arg",
          "n={{seq}}",
          "--load",
          "--load-requests",
          "9",
          "--load-concurrency",
          "3",
          "--load-workers",
          "3",
          "--format",
          "json",
        ].slice(2),
        { env: { [LOAD_WORKER_ENTRY_ENV]: BIN }, timeout: 30_000 },
      );
      expectCliSuccess(result);
      const json = expectValidJson(result).result;
      expect(json).toMatchObject({
        tool: "ping",
        concurrency: 3,
        requestLimit: 9,
        requests: 9,
        ok: 9,
        workers: 3,
      });
      // Every worker's `{{seq}}` is its own: nine calls, nine numbers.
      expect(new Set(seqs).size).toBe(9);
    } finally {
      await server.stop();
    }
  }, 40_000);

  it("looks the tool up once, in the parent, before forking", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("load-workers-missing", "1.0.0"),
      tools: [],
    });
    try {
      await server.start();
      const result = await runCli(
        [
          server.url,
          "--cli",
          "--transport",
          "http",
          "--method",
          "tools/call",
          "--tool-name",
          "missing",
          "--load",
          "--load-requests",
          "2",
          "--load-workers",
          "2",
        ],
        // A worker would fail to start from this entry: none must.
        { env: { [LOAD_WORKER_ENTRY_ENV]: "/nonexistent/worker.js" } },
      );
      expect(result.exitCode).toBe(EXIT_CODES.TOOL_ERROR);
      expect(result.stderr).toContain("Tool 'missing' not found on server.");
    } finally {
      await server.stop();
    }
  });

  const { command, args } = getTestMcpServerCommand();
  it.each([
    [
      ["--method", "tools/call", "--load-workers", "2"],
      "--load-workers requires --load.",
    ],
    [
      [
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--load",
        "--load-workers",
        "2",
      ],
      "--load-workers above 1 requires an HTTP or SSE server",
    ],
    [
      [
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--load",
        "--load-workers",
        "2",
        "--output",
        "/tmp/x.ndjson",
      ],
      "--load-workers cannot be combined with --output",
    ],
    [
      ["--method", "tools/call", "--load", "--load-workers", "0"],
      "--load-workers must be a positive integer.",
    ],
  ])("rejects %j", async (flags, message) => {
    const result = await runCli([command, ...args, "--cli", ...flags]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(message);
  });
});
