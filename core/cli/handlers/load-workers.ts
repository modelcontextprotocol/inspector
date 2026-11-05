import { fork } from "node:child_process";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import {
  OutcomeStats,
  stopFromAbort,
  type LoadOptions,
  type LoadProgress,
  type LoadProgressHook,
  type LoadRawStats,
  type LoadRunObserver,
  type LoadStop,
  type LoadSummary,
  type LoadWarmupSummary,
} from "./load-test.js";

/**
 * `--load-workers <n>` (#2914): a multi-process load generator. One Node
 * process trails a bare SDK client by ~18% at concurrency 10–50, so at high
 * load the generator rather than the server can be the bottleneck; this
 * spreads one run over `n` processes and merges their results into one
 * summary.
 *
 * - **The parent** (the CLI the user ran) connects once, so any login is
 *   done before a worker starts, then re-runs its own command `n` times as
 *   child processes with `MCP_INSPECTOR_LOAD_SHARD=<index>/<n>` set, and
 *   waits. It merges what they send back and prints, grades and compares the
 *   merged summary exactly as it would its own.
 * - **A worker** sees the variable, takes its share of the run with
 *   {@link shardLoadOptions} — concurrency, `--load-requests` and
 *   `--load-rate` split as evenly as the counts allow — connects with stored
 *   credentials only, runs the engine, and sends its summary and its
 *   mergeable raw stats ({@link LoadRawStats}) to the parent over IPC
 *   instead of printing anything.
 * - **Merging is exact.** The latency histograms (#2838) and the error
 *   tallies merge as if one recorder had seen every call; counts add; the
 *   rate figures add; the wall clock is the slowest worker's.
 * - **One stop reaches every worker.** A worker whose circuit breaker trips
 *   (or that fails outright) makes the parent stop the rest with the same
 *   reason, and Ctrl+C or SIGTERM in the parent stops them all — so the
 *   merged run still reports `stoppedEarly` and exits as one run would.
 */

/** Set in a worker process: `<index>/<count>`. */
export const LOAD_WORKER_ENV = "MCP_INSPECTOR_LOAD_SHARD";

/**
 * Overrides the script a parent re-runs as its workers. Unset, it is the
 * process's own entry (`process.argv[1]`) with its own arguments — the CLI
 * bin or the launcher. Tests that drive the CLI in-process, where that entry
 * is the test runner, point it at the built CLI instead.
 */
export const LOAD_WORKER_ENTRY_ENV = "MCP_INSPECTOR_LOAD_WORKER_ENTRY";

/** What a worker sends its parent. */
export type LoadWorkerMessage =
  | { type: "progress"; progress: LoadProgress }
  /** The worker's run stopped early; sent as it happens, before draining. */
  | { type: "stopped"; stop: LoadStop }
  | { type: "result"; summary: LoadSummary; raw: LoadRawStats };

/** What a parent sends a worker. */
export type LoadWorkerCommand = { type: "stop"; stop: LoadStop };

/** A worker process, as the parent sees it. */
export type LoadWorkerHandle = {
  onMessage: (listener: (message: LoadWorkerMessage) => void) => void;
  send: (command: LoadWorkerCommand) => void;
  /** Settles with the exit code once the process has exited. */
  exited: Promise<number | null>;
};

/** This process's shard, when it is a worker; `undefined` otherwise. */
export function readLoadShard(
  env: NodeJS.ProcessEnv = process.env,
): { index: number; count: number } | undefined {
  const match = /^(\d+)\/(\d+)$/.exec(env[LOAD_WORKER_ENV] ?? "");
  if (!match) return undefined;
  const index = Number(match[1]);
  const count = Number(match[2]);
  return index < count ? { index, count } : undefined;
}

/** `total` split `count` ways as evenly as integers allow: share `index`. */
function share(total: number, index: number, count: number): number {
  return Math.floor(total / count) + (index < total % count ? 1 : 0);
}

/**
 * Worker `index` of `count`'s part of a run: its share of the concurrency,
 * of `--load-requests` and of `--load-rate`, and the shard that keeps its
 * `{{seq}}` / `{{worker}}` unique. Everything else — duration, warm-up,
 * scenario, arguments, open loop — every worker runs as given.
 */
export function shardLoadOptions(
  options: LoadOptions,
  index: number,
  count: number,
): LoadOptions {
  const sharded: LoadOptions = {
    ...options,
    concurrency: share(options.concurrency, index, count),
    ...(options.requests !== undefined && {
      requests: share(options.requests, index, count),
    }),
    ...(options.rate !== undefined && { rate: options.rate / count }),
    shard: { index, count },
  };
  delete sharded.workers;
  return sharded;
}

/**
 * The arguments a parent re-runs as its workers: its own, without
 * `--load-workers` (a worker is never a parent).
 */
export function workerArgv(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--load-workers") {
      i++;
      continue;
    }
    if (arg.startsWith("--load-workers=")) continue;
    // The parent logs in again once; a worker replaying `--relogin` would
    // delete (and revoke) the credentials it is about to need.
    if (arg === "--relogin" || arg === "--no-revoke") continue;
    out.push(arg);
  }
  return out;
}

/** Fork one worker process running `entry` with `args`. */
export function forkLoadWorker(
  entry: string,
  args: string[],
  index: number,
  count: number,
): LoadWorkerHandle {
  const child = fork(entry, args, {
    env: { ...process.env, [LOAD_WORKER_ENV]: `${index}/${count}` },
    // The worker prints nothing to stdout; its stderr (a failure's envelope)
    // is the user's to see.
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    execArgv: [],
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
    // A spawn that failed outright never exits; report it as a failure.
    child.once("error", () => resolve(null));
  });
  return {
    onMessage: (listener) => {
      child.on("message", (message) => listener(message as LoadWorkerMessage));
    },
    send: (command) => {
      if (child.connected) child.send(command);
    },
    exited,
  };
}

/**
 * Run the parent's half: start `count` workers with `spawn`, relay stops
 * and progress, and merge their results. A worker that exits without a
 * result fails the run with its exit code, once the others have stopped.
 */
export async function runLoadWorkers(
  count: number,
  spawn: (index: number) => LoadWorkerHandle,
  options: LoadOptions,
  run: { signal?: AbortSignal; progress?: LoadProgressHook } = {},
): Promise<LoadSummary> {
  const results: ({ summary: LoadSummary; raw: LoadRawStats } | undefined)[] =
    Array.from({ length: count }, () => undefined);
  const latest: (LoadProgress | undefined)[] = Array.from(
    { length: count },
    () => undefined,
  );
  const handles: LoadWorkerHandle[] = [];
  let stopped = false;
  const send = (stop: LoadStop): void =>
    handles.forEach((h, i) => {
      if (results[i] === undefined) h.send({ type: "stop", stop });
    });
  const stopAll = (stop: LoadStop): void => {
    if (stopped) return;
    stopped = true;
    send(stop);
  };
  // The parent's own interrupt is not latched behind a worker's stop, and
  // it is what the merged run reports: an explicit interrupt outranks a
  // breaker stop, as it does within one run.
  let interrupted: LoadStop | undefined;
  const onAbort = (): void => {
    interrupted = stopFromAbort(run.signal?.reason);
    stopped = true;
    send(interrupted);
  };

  for (let index = 0; index < count; index++) {
    const handle = spawn(index);
    handles.push(handle);
    handle.onMessage((message) => {
      if (message.type === "progress") {
        latest[index] = message.progress;
        return;
      }
      if (message.type === "stopped") {
        stopAll(message.stop);
        return;
      }
      results[index] = { summary: message.summary, raw: message.raw };
      // One worker's breaker (or stop on breach) ends every worker's run.
      const stop = message.summary.stoppedEarly;
      if (stop !== undefined) stopAll(stop);
    });
  }
  if (run.signal?.aborted) onAbort();
  else run.signal?.addEventListener("abort", onAbort, { once: true });

  const progress = run.progress;
  const ticker =
    progress !== undefined
      ? setInterval(() => {
          const merged = mergeLoadProgress(latest);
          if (merged !== undefined) progress.emit(merged);
        }, progress.everyMs)
      : undefined;
  // Progress is advisory: it must never hold the process open.
  ticker?.unref();

  let failure: { index: number; code: number | null } | undefined;
  try {
    await Promise.all(
      handles.map(async (handle, index) => {
        const code = await handle.exited;
        if (results[index] === undefined) {
          failure ??= { index, code };
          // The rest have nothing left to be part of.
          stopAll({
            reason: "interrupted",
            detail: `load worker ${index} failed`,
          });
        }
      }),
    );
  } finally {
    clearInterval(ticker);
    run.signal?.removeEventListener("abort", onAbort);
  }
  if (failure !== undefined) {
    throw new CliExitCodeError(
      failure.code !== null && failure.code !== 0
        ? failure.code
        : EXIT_CODES.USAGE,
      `--load-workers: worker ${failure.index} exited${failure.code !== null ? ` with code ${failure.code}` : ""} before reporting its results.`,
      { code: "load_worker_failed" },
    );
  }
  const merged = mergeLoadWorkerResults(
    results.map((r) => r!),
    options,
  );
  return interrupted !== undefined &&
    merged.stoppedEarly?.reason !== "interrupted"
    ? { ...merged, stoppedEarly: interrupted }
    : merged;
}

/**
 * The parent's progress line: every worker's latest report, added up. The
 * latency is the slowest worker's p50 and p99 — percentiles do not add, and
 * a progress line is a glance, not the result.
 */
export function mergeLoadProgress(
  reports: (LoadProgress | undefined)[],
): LoadProgress | undefined {
  const present = reports.filter((r): r is LoadProgress => r !== undefined);
  if (present.length === 0) return undefined;
  const latencies = present.flatMap((r) => (r.latencyMs ? [r.latencyMs] : []));
  return {
    phase: present.some((r) => r.phase === "warmup") ? "warmup" : "run",
    elapsedMs: Math.max(...present.map((r) => r.elapsedMs)),
    requests: sum(present.map((r) => r.requests)),
    ok: sum(present.map((r) => r.ok)),
    failed: sum(present.map((r) => r.failed)),
    throughput: round2(sum(present.map((r) => r.throughput))),
    latencyMs:
      latencies.length === 0
        ? null
        : {
            p50: Math.max(...latencies.map((l) => l.p50)),
            p99: Math.max(...latencies.map((l) => l.p99)),
          },
  };
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The merged run's calls started per second: every start over one window
 * covering them all, as one process would have measured it. That is the
 * longest worker's own window — a duration or an early stop bounds each the
 * same way — except when `--load-requests` ran out: then the run stopped
 * starting at the run grid's first slot after its last start, as one
 * process's request-capped window does. Adding the workers' own rates
 * instead would divide each by a different window.
 */
function mergedAchievedRate(
  results: { summary: LoadSummary; raw: LoadRawStats }[],
  options: LoadOptions,
): number {
  const windows = results.flatMap((r) => (r.raw.rate ? [r.raw.rate] : []));
  const started = sum(windows.map((w) => w.started));
  if (started === 0) return 0;
  let windowMs = Math.max(...windows.map((w) => w.windowMs));
  const exhausted =
    options.requests !== undefined &&
    started >= options.requests &&
    results.every((r) => r.summary.stoppedEarly === undefined);
  if (exhausted) {
    const interval = 1000 / options.rate!;
    const lastStart = Math.max(...windows.map((w) => w.lastStartMs));
    const afterLast = (Math.floor(lastStart / interval + 1e-9) + 1) * interval;
    windowMs = Math.min(windowMs, afterLast);
  }
  return windowMs > 0 ? round2((started * 1000) / windowMs) : 0;
}

/** The stop to report for the merged run: an interrupt first, else the first. */
function mergedStop(summaries: LoadSummary[]): LoadStop | undefined {
  const stops = summaries.flatMap((s) =>
    s.stoppedEarly ? [s.stoppedEarly] : [],
  );
  return stops.find((s) => s.reason === "interrupted") ?? stops[0];
}

function mergedWarmup(summaries: LoadSummary[]): LoadWarmupSummary | undefined {
  const warmups = summaries.flatMap((s) => (s.warmup ? [s.warmup] : []));
  if (warmups.length === 0) return undefined;
  const stop = warmups.find((w) => w.stoppedEarly)?.stoppedEarly;
  return {
    durationMs: Math.max(...warmups.map((w) => w.durationMs)),
    requests: sum(warmups.map((w) => w.requests)),
    ok: sum(warmups.map((w) => w.ok)),
    failed: sum(warmups.map((w) => w.failed)),
    ...(stop !== undefined && { stoppedEarly: stop }),
  };
}

/**
 * One summary from every worker's: the shape of the run as asked for
 * (`options`, before it was split), the merged counts and latencies, and
 * the slowest worker's wall clock.
 */
export function mergeLoadWorkerResults(
  results: { summary: LoadSummary; raw: LoadRawStats }[],
  options: LoadOptions,
): LoadSummary {
  const summaries = results.map((r) => r.summary);
  const first = summaries[0]!;
  const elapsedMs = Math.max(...summaries.map((s) => s.elapsedMs));
  const total = new OutcomeStats();
  for (const r of results) total.merge(r.raw.total);
  const totals = total.summarize(elapsedMs);
  const stop = mergedStop(summaries);
  const warmup = mergedWarmup(summaries);
  const rated = options.rate !== undefined;
  return {
    ...(first.tool !== undefined && { tool: first.tool }),
    concurrency: options.concurrency,
    ...(options.durationMs !== undefined && {
      durationMs: options.durationMs,
    }),
    ...(options.requests !== undefined && { requestLimit: options.requests }),
    ...(options.openLoop === true && { openLoop: true }),
    ...(rated && {
      rate: options.rate,
      plannedStarts: sum(summaries.map((s) => s.plannedStarts ?? 0)),
      droppedSlots: sum(summaries.map((s) => s.droppedSlots ?? 0)),
      achievedRate: mergedAchievedRate(results, options),
    }),
    requests: totals.requests,
    ok: totals.ok,
    toolErrors: totals.toolErrors,
    errors: totals.errors,
    errorRate: totals.errorRate,
    elapsedMs: round2(elapsedMs),
    throughput: totals.throughput,
    okThroughput: totals.okThroughput,
    latencyMs: totals.latencyMs,
    errorLatencyMs: totals.errorLatencyMs,
    errorMessages: totals.errorMessages,
    toolErrorMessages: totals.toolErrorMessages,
    ...(stop !== undefined && { stoppedEarly: stop }),
    ...(first.steps && {
      steps: first.steps.map((step, i) => {
        const stats = new OutcomeStats();
        for (const r of results) stats.merge(r.raw.steps![i]!);
        return {
          name: step.name,
          method: step.method,
          target: step.target,
          weight: step.weight,
          ...stats.summarize(elapsedMs),
        };
      }),
    }),
    ...(warmup !== undefined && { warmup }),
    workers: results.length,
  };
}

/** A worker's channel to its parent: Node's IPC in a forked process. */
export type LoadWorkerPort = {
  send: (message: LoadWorkerMessage) => Promise<void>;
  onCommand: (listener: (command: LoadWorkerCommand) => void) => () => void;
};

/**
 * The part of a Node process {@link processWorkerPort} uses: its IPC `send`
 * (absent without a channel) and its `message` events.
 */
export type IpcProcess = {
  send?: (
    message: unknown,
    sendHandle: undefined,
    options: undefined,
    callback: (error: Error | null) => void,
  ) => boolean;
  on: (event: "message", listener: (message: unknown) => void) => unknown;
  off: (event: "message", listener: (message: unknown) => void) => unknown;
};

/** The {@link LoadWorkerPort} of this process, forked with an IPC channel. */
export function processWorkerPort(proc: IpcProcess = process): LoadWorkerPort {
  return {
    send: (message) =>
      new Promise((resolve, reject) => {
        if (!proc.send) {
          reject(new Error("load worker has no IPC channel to its parent"));
          return;
        }
        proc.send(message, undefined, undefined, (err: Error | null) =>
          err ? reject(err) : resolve(),
        );
      }),
    onCommand: (listener) => {
      const handler = (message: unknown): void =>
        listener(message as LoadWorkerCommand);
      proc.on("message", handler);
      return () => proc.off("message", handler);
    },
  };
}

/**
 * Run a worker's half: `run` with a signal the parent's stop aborts, its
 * progress relayed, and its summary and raw stats sent back at the end.
 */
export async function runAsLoadWorker(
  port: LoadWorkerPort,
  run: (worker: {
    signal: AbortSignal;
    progress: (progress: LoadProgress) => void;
    observe: LoadRunObserver;
  }) => Promise<LoadSummary>,
): Promise<void> {
  const stop = new AbortController();
  const off = port.onCommand((command) => {
    if (command.type === "stop") stop.abort(command.stop);
  });
  let raw: LoadRawStats | undefined;
  try {
    const summary = await run({
      signal: stop.signal,
      // Advisory, like the one-shot CLI's own progress line.
      progress: (progress) => {
        void port.send({ type: "progress", progress }).catch(() => {});
      },
      observe: {
        raw: (r) => {
          raw = r;
        },
        // Told at once, so the parent can stop the other workers while
        // this one's in-flight calls drain. A stop the parent sent needs
        // no echo.
        stop: (s) => {
          if (!stop.signal.aborted) {
            void port.send({ type: "stopped", stop: s }).catch(() => {});
          }
        },
      },
    });
    // The engine hands over a run's raw stats as its measured window ends,
    // so a summary always comes with them.
    await port.send({ type: "result", summary, raw: raw! });
  } finally {
    off();
  }
}
