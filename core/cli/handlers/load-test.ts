import type { Tool } from "@modelcontextprotocol/client";
import type { InspectorClient } from "../../mcp/index.js";
import { ManagedToolsState } from "../../mcp/state/index.js";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import type { MethodArgs } from "./method-types.js";

/**
 * `--load` (#2439): drive one tool with sustained, concurrent `tools/call`
 * traffic over the connection the Inspector already set up — transport, OAuth
 * and headers included — and report latency and error rate at the end.
 *
 * Lives in `core/cli/` so the one-shot CLI and `mcpdo` share one engine:
 * `mcpdo` runs it inside the daemon against a live connection (#2744).
 *
 * All calls share ONE connection, so this measures how a server handles
 * concurrent requests on a session, not how it handles many sessions.
 */

/** Bounds for one load run. Validated by the caller before connecting. */
export type LoadOptions = {
  /** Most calls in flight at once. */
  concurrency: number;
  /** Stop starting calls after this long. In-flight calls still finish. */
  durationMs?: number;
  /** Stop after this many calls have been started. */
  requests?: number;
  /** Cap on calls started per second, across all workers. */
  rate?: number;
};

/** How one call ended. `tool_error` is a result carrying `isError: true`. */
export type LoadCallOutcome = "ok" | "tool_error";

/** Latency distribution in milliseconds, nearest-rank percentiles. */
export type LoadLatency = {
  min: number;
  mean: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
};

export type LoadSummary = {
  tool?: string;
  concurrency: number;
  durationMs?: number;
  requestLimit?: number;
  rate?: number;
  /** Calls that completed, in any outcome. */
  requests: number;
  ok: number;
  /** Calls that returned a result with `isError: true`. */
  toolErrors: number;
  /** Calls that threw: protocol errors, timeouts, transport failures. */
  errors: number;
  /** `(toolErrors + errors) / requests` to four places; 0 when none completed. */
  errorRate: number;
  elapsedMs: number;
  /** Completed calls per second of wall clock. */
  throughput: number;
  /** `null` when no call completed. */
  latencyMs: LoadLatency | null;
  /** Thrown messages by frequency, at most {@link MAX_ERROR_KINDS} of them. */
  errorMessages: { message: string; count: number }[];
};

export const DEFAULT_LOAD_CONCURRENCY = 10;
/** Applied only when neither a duration nor a request count is given. */
export const DEFAULT_LOAD_DURATION_MS = 10_000;

/**
 * Commander-style parser for a positive integer flag (`--load-concurrency`,
 * `--load-requests`). Plain decimal digits only, so `1.5`, `1e3` and `0x10`
 * are refused rather than coerced.
 */
export function positiveIntegerParser(flag: string): (value: string) => number {
  return (value: string): number => {
    const trimmed = value.trim();
    const n = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new Error(`${flag} must be a positive integer.`);
    }
    return n;
  };
}

/** Commander-style parser for a positive, finite number flag. */
export function positiveNumberParser(flag: string): (value: string) => number {
  return (value: string): number => {
    const n = value.trim() === "" ? NaN : Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${flag} must be a positive number.`);
    }
    return n;
  };
}

/**
 * Turn the raw flag values into {@link LoadOptions}, applying the defaults:
 * {@link DEFAULT_LOAD_CONCURRENCY} workers, and a
 * {@link DEFAULT_LOAD_DURATION_MS} window when no request count bounds the
 * run instead. Given both, the run stops at whichever is reached first.
 */
export function resolveLoadOptions(flags: {
  concurrency?: number;
  durationSec?: number;
  requests?: number;
  rate?: number;
}): LoadOptions {
  const durationMs =
    flags.durationSec !== undefined
      ? flags.durationSec * 1000
      : flags.requests === undefined
        ? DEFAULT_LOAD_DURATION_MS
        : undefined;
  return {
    concurrency: flags.concurrency ?? DEFAULT_LOAD_CONCURRENCY,
    ...(durationMs !== undefined && { durationMs }),
    ...(flags.requests !== undefined && { requests: flags.requests }),
    ...(flags.rate !== undefined && { rate: flags.rate }),
  };
}

/** Distinct error messages kept; the rest fold into one `(other)` entry. */
export const MAX_ERROR_KINDS = 10;
export const OTHER_ERRORS = "(other)";

/** Injected so tests can drive the clock instead of waiting on it. */
export type LoadClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const realClock: LoadClock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * {@link LoadClock.sleep}, cut short when `signal` aborts. The timer itself
 * still fires later; only the wait ends early, so a slow `--load-rate` slot
 * never holds a cancelled run open for a whole interval.
 */
function sleepUnlessAborted(
  clock: LoadClock,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) return clock.sleep(ms);
  return new Promise((resolve) => {
    const done = (): void => {
      signal.removeEventListener("abort", done);
      resolve();
    };
    signal.addEventListener("abort", done, { once: true });
    void clock.sleep(ms).then(done); // `sleep` never rejects
  });
}

/** Nearest-rank percentile over an ascending-sorted, non-empty array. */
export function percentile(sorted: number[], p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]!;
}

function round(n: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(n * scale) / scale;
}

export function summarizeLatency(latencies: number[]): LoadLatency | null {
  if (latencies.length === 0) return null;
  const sorted = [...latencies].sort((a, b) => a - b);
  const total = sorted.reduce((sum, n) => sum + n, 0);
  return {
    min: round(sorted[0]!),
    mean: round(total / sorted.length),
    p50: round(percentile(sorted, 50)),
    p90: round(percentile(sorted, 90)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1]!),
  };
}

/**
 * Count thrown messages, keeping the first {@link MAX_ERROR_KINDS} distinct
 * ones seen. A failing server tends to fail the same way every time, but one
 * that embeds a request id in each message would otherwise grow the map by
 * one key per call for the whole run.
 */
class ErrorTally {
  private readonly counts = new Map<string, number>();
  private other = 0;

  add(message: string): void {
    const count = this.counts.get(message);
    if (count !== undefined) this.counts.set(message, count + 1);
    else if (this.counts.size < MAX_ERROR_KINDS) this.counts.set(message, 1);
    else this.other++;
  }

  entries(): { message: string; count: number }[] {
    const list = [...this.counts].map(([message, count]) => ({
      message,
      count,
    }));
    list.sort((a, b) => b.count - a.count);
    if (this.other > 0) list.push({ message: OTHER_ERRORS, count: this.other });
    return list;
  }
}

/**
 * Run `call` under the given bounds and summarize what happened. Workers pull
 * slots from a shared counter, so `concurrency` is a hard cap on calls in
 * flight and `requests` a hard cap on calls started. With `rate`, starts
 * follow an even `1 / rate` grid rather than a burst each second.
 *
 * The rate limiter keys off the time the last slot was actually taken, not
 * off the run's start: a slot nobody was free to take is dropped rather than
 * owed, so a stall — one slow call at concurrency 1, or timers firing late —
 * is never followed by a catch-up burst against a server that may just be
 * recovering. A slot past the duration is never started.
 *
 * Aborting `signal` ends the run early: no further call starts, in-flight
 * calls are left to settle, and the summary covers what completed.
 */
export async function runLoad(
  call: () => Promise<LoadCallOutcome>,
  options: LoadOptions,
  clock: LoadClock = realClock,
  signal?: AbortSignal,
): Promise<LoadSummary> {
  const { concurrency, durationMs, requests, rate } = options;
  const latencies: number[] = [];
  const tally = new ErrorTally();
  let ok = 0;
  let toolErrors = 0;
  let errors = 0;
  let started = 0;

  const start = clock.now();
  const deadline = durationMs === undefined ? Infinity : start + durationMs;
  const interval = rate === undefined ? 0 : 1000 / rate;
  // Earliest time the next slot may start.
  let nextStart = start;

  // FIFO turnstile: workers wanting a slot queue on a promise chain, and only
  // the one at the head waits on the clock. Without it, every idle worker
  // armed its own timer for the same slot and all but one re-armed on waking
  // — at concurrency 100 that is 99 wasted timers per call, enough to make
  // the generator the bottleneck at a high --load-rate.
  let turnstile: Promise<void> = Promise.resolve();

  /**
   * Wait for a slot and take it, or return false when the run is over. Only
   * the worker at the head of the turnstile is ever waiting on the clock, and
   * it claims a slot only once it is awake at that slot's time, re-checking
   * the bounds on every wake. So a timer that fires late — a stalled event
   * loop — starts one call, never a burst of everything that was due.
   */
  const claimSlot = async (): Promise<boolean> => {
    const ahead = turnstile;
    let release!: () => void;
    turnstile = new Promise((resolve) => (release = resolve));
    await ahead;
    try {
      for (;;) {
        if (signal?.aborted) return false;
        if (requests !== undefined && started >= requests) return false;
        const now = clock.now();
        if (now >= deadline) return false;
        const scheduled = Math.max(nextStart, now);
        if (scheduled >= deadline) return false;
        if (scheduled <= now) {
          started++;
          // A wake that is merely late — timers always are, by a fraction of
          // a millisecond — keeps the slot grid, so the average rate holds.
          // Only a slot missed entirely (a stall longer than one interval)
          // is dropped, and spacing restarts from now: no catch-up burst.
          nextStart =
            now - nextStart < interval ? nextStart + interval : now + interval;
          return true;
        }
        await sleepUnlessAborted(clock, scheduled - now, signal);
      }
    } finally {
      release();
    }
  };

  const worker = async (): Promise<void> => {
    while (await claimSlot()) {
      const t0 = clock.now();
      try {
        const outcome = await call();
        if (outcome === "ok") ok++;
        else toolErrors++;
      } catch (err) {
        errors++;
        tally.add(err instanceof Error ? err.message : String(err));
      }
      latencies.push(clock.now() - t0);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  const elapsedMs = clock.now() - start;
  const completed = ok + toolErrors + errors;
  return {
    concurrency,
    ...(durationMs !== undefined && { durationMs }),
    ...(requests !== undefined && { requestLimit: requests }),
    ...(rate !== undefined && { rate }),
    requests: completed,
    ok,
    toolErrors,
    errors,
    // Four places, so a rare failure under heavy load (23 in 41k) still shows.
    errorRate:
      completed === 0 ? 0 : round((toolErrors + errors) / completed, 4),
    elapsedMs: round(elapsedMs),
    throughput: elapsedMs > 0 ? round((completed * 1000) / elapsedMs) : 0,
    latencyMs: summarizeLatency(latencies),
    errorMessages: tally.entries(),
  };
}

/**
 * Resolve `args.toolName` once, then load it with {@link runLoad}. The tool
 * lookup happens before the clock starts, so a missing tool fails the run
 * outright (exit 5, as a plain `tools/call` would) instead of being reported
 * as a 100% error rate.
 */
export async function runToolLoad(
  inspectorClient: InspectorClient,
  args: MethodArgs,
  options: LoadOptions,
  run: { clock?: LoadClock; signal?: AbortSignal } = {},
): Promise<LoadSummary> {
  if (!args.toolName) {
    throw new Error("--load requires --tool-name.");
  }
  const toolsState = new ManagedToolsState(inspectorClient);
  let found: Tool | undefined;
  try {
    toolsState.setMetadata(args.metadata);
    await toolsState.refresh();
    found = toolsState.getTools().find((t) => t.name === args.toolName);
  } finally {
    toolsState.destroy();
  }
  if (!found) {
    throw new CliExitCodeError(
      EXIT_CODES.TOOL_ERROR,
      `Tool '${args.toolName}' not found on server.`,
      { code: "tool_not_found" },
    );
  }
  const tool = found;
  // Same rule as a single `tools/call` (#2649): a tool that requires task
  // support can only be called task-augmented.
  const useTask = tool.execution?.taskSupport === "required";
  const call = async (): Promise<LoadCallOutcome> => {
    const params = [
      tool,
      args.toolArg ?? {},
      args.metadata,
      args.toolMeta,
    ] as const;
    const invocation = useTask
      ? await inspectorClient.callToolStream(...params)
      : await inspectorClient.callTool(...params);
    /* v8 ignore next 3 -- defensive: `ToolCallInvocation.result` is nullable,
       but both call paths throw on failure rather than return a null result. */
    if (invocation.result === null) {
      throw new Error(invocation.error ?? "Tool call failed");
    }
    return invocation.result.isError === true ? "tool_error" : "ok";
  };
  const summary = await runLoad(call, options, run.clock, run.signal);
  return { tool: tool.name, ...summary };
}
