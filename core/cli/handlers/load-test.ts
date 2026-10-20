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
 * Lives in `core/cli/` rather than the CLI client so `mcpdo` can reuse it
 * against a daemon connection without a second copy; only the one-shot CLI
 * exposes it today.
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
 * flight and `requests` a hard cap on calls started. With `rate`, starts are
 * at least `1 / rate` seconds apart — an even schedule rather than a burst
 * each second.
 *
 * The rate limiter keys off the time the last slot was actually taken, not
 * off the run's start: a slot nobody was free to take is dropped rather than
 * owed, so a stall — one slow call at concurrency 1, or timers firing late —
 * is never followed by a catch-up burst against a server that may just be
 * recovering. A slot past the duration is never started.
 */
export async function runLoad(
  call: () => Promise<LoadCallOutcome>,
  options: LoadOptions,
  clock: LoadClock = realClock,
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

  /**
   * Wait for a slot and take it, or return false when the run is over. A
   * slot is claimed only by a worker that is awake at its time — never
   * reserved before a wait — and every wake re-checks the bounds. So if the
   * event loop stalls and several workers' timers all fire late at once, the
   * first to run takes the slot and the rest go back to waiting, rather than
   * starting together. The claim itself is synchronous, so two workers can
   * never take the same slot.
   */
  const claimSlot = async (): Promise<boolean> => {
    for (;;) {
      if (requests !== undefined && started >= requests) return false;
      const now = clock.now();
      if (now >= deadline) return false;
      const scheduled = Math.max(nextStart, now);
      if (scheduled >= deadline) return false;
      if (scheduled <= now) {
        started++;
        nextStart = now + interval;
        return true;
      }
      await clock.sleep(scheduled - now);
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
  clock?: LoadClock,
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
  const summary = await runLoad(call, options, clock);
  return { tool: tool.name, ...summary };
}
