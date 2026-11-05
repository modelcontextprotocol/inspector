import type { Tool } from "@modelcontextprotocol/client";
import type { InspectorClient } from "../../mcp/index.js";
import type { RequestMetadata } from "../../mcp/types.js";
import { ManagedToolsState } from "../../mcp/state/index.js";
import { CliExitCodeError, EXIT_CODES } from "../exit-codes.js";
import type { MethodArgs } from "./method-types.js";
import {
  createWeightedPicker,
  loadStepTarget,
  type LoadScenario,
  type LoadScenarioMethod,
  type LoadScenarioStep,
} from "./load-scenario.js";
import {
  loadArgsTemplate,
  loadTemplateOrConstant,
  type LoadArgRows,
  type LoadArgsRow,
  type LoadCallContext,
  type LoadTemplate,
} from "./load-template.js";
import type { LoadStages, LoadStepBy } from "./load-stages.js";
import { loadThresholdBreaches } from "./load-thresholds.js";
import {
  LatencyRecorder,
  summarizeLatency,
  type LatencySnapshot,
  type LoadLatency,
} from "./load-latency.js";
import type { LoadFanoutOptions, LoadFanoutSummary } from "./load-fanout.js";

/**
 * `--load` (#2439): drive one tool with sustained, concurrent `tools/call`
 * traffic over the connection the Inspector already set up — transport, OAuth
 * and headers included — and report latency and error rate at the end.
 *
 * Lives in `core/cli/` so the one-shot CLI and `mcpdo` share one engine:
 * `mcpdo` runs it inside the daemon against a live connection (#2744).
 *
 * By default all calls share ONE connection, so this measures how a server
 * handles concurrent requests on a session. `connections` (#2746) spreads the
 * workers over that many independent sessions instead — see
 * {@link runLoadAcrossConnections} for how they are opened, shared and closed.
 */

/** Bounds for one load run. Validated by the caller before connecting. */
export type LoadOptions = {
  /** Most calls in flight at once, across all connections. */
  concurrency: number;
  /**
   * Independent connections (sessions) to spread the workers over (#2746).
   * Absent means one — the connection the caller already opened.
   */
  connections?: number;
  /** Stop starting calls after this long. In-flight calls still finish. */
  durationMs?: number;
  /** Stop after this many calls have been started. */
  requests?: number;
  /** Cap on calls started per second, across all workers. */
  rate?: number;
  /**
   * `--load-scenario` (#2839): a weighted mix of steps to run in place of one
   * tool. Each call runs the step the weighted picker names, and the summary
   * gains a per-step breakdown in `steps`.
   */
  scenario?: LoadScenario;
  /**
   * `--load-args-file` (#2840): argument rows merged over the tool's flag
   * arguments, one per call, in turn or at random. Single-tool runs only.
   */
  argRows?: LoadArgRows;
  /**
   * `--load-steps` / `--load-ramp` (#2841): run consecutive stages, each at
   * its own concurrency or rate for `stageMs`, in place of one window. With
   * stages, `durationMs` and `requests` are unset and `concurrency` is the
   * highest concurrency level (or the worker pool, when stepping the rate).
   */
  stages?: LoadStages;
  /**
   * `--load-interval` (#2838): also report the run as a time series of
   * buckets this long, by completion time, in `intervals`.
   */
  intervalMs?: number;
  /**
   * `--load-warmup` (#2838): run this long first, at the same concurrency
   * and rate, and leave those calls out of every statistic.
   */
  warmupMs?: number;
  /**
   * `--load-progress` (#2838): how often the front end wants a progress
   * report. The engine does not read it — a caller turns it into the
   * {@link LoadProgressHook} it passes — but it rides here so mcpdo's daemon,
   * which runs the engine, learns it with the rest of the run.
   */
  progressMs?: number;
  /**
   * `--load-open-loop` (#2838; needs `rate`): keep every slot of the rate
   * grid instead of dropping the ones no worker was free for, and time each
   * call from its scheduled start, so queueing behind a slow server shows in
   * the latency rather than being hidden by a slower request rate.
   */
  openLoop?: boolean;
  /**
   * `--load-churn` (#2912): every worker opens a fresh session, makes
   * `callsPerSession` calls on it, and closes it, over and over, so session
   * setup and teardown are under load too. Replaces `connections`.
   */
  churn?: { callsPerSession: number };
  /**
   * `--load-subscribe` (#2913): notification fan-out. Run by
   * `runLoadOrFanout` in `load-fanout.ts`, which subscribes the sessions and
   * hands the rest of these options to the engine as the triggers.
   */
  fanout?: LoadFanoutOptions;
  /**
   * `--load-workers` (#2914): the processes to spread the run over. Read by
   * the CLI, which forks them; the engine itself never sees more than one.
   */
  workers?: number;
  /**
   * Set in a worker process (#2914): its index among `count`, so the `seq`
   * and `worker` its calls see stay unique across every process.
   */
  shard?: { index: number; count: number };
};

/**
 * How one call ended. `tool_error` is a result carrying `isError: true`; the
 * object form carries the message that result held (#2836), so a run that is
 * 100% `rate limited` says so in `toolErrorMessages`.
 */
export type LoadCallOutcome = "ok" | "tool_error" | LoadToolError;

/** A tool error with the text its result carried (#2836). */
export type LoadToolError = { outcome: "tool_error"; message: string };

/**
 * Why a run ended before its bounds did (#2834, #2835):
 *
 * - `interrupted`: the caller aborted it (Ctrl+C / SIGTERM, a hung-up client).
 * - `connection_lost`: the caller saw the connection go terminal and aborted.
 * - `consecutive_errors`: the engine's own circuit breaker tripped, because
 *   calls had done nothing but throw for long enough that the server is
 *   clearly gone (see {@link CIRCUIT_BREAKER_ERRORS}).
 */
export type LoadStopReason =
  | "interrupted"
  | "connection_lost"
  | "consecutive_errors"
  | "threshold_breached";

/** An early stop, as reported in {@link LoadSummary.stoppedEarly}. */
export type LoadStop = { reason: LoadStopReason; detail: string };

// Latency recording lives in `load-latency.ts` (#2838): bounded memory, and
// p95 / p99.9 alongside the original percentiles.
export type { LoadLatency } from "./load-latency.js";
export { percentile, summarizeLatency } from "./load-latency.js";

export type LoadSummary = {
  tool?: string;
  concurrency: number;
  durationMs?: number;
  requestLimit?: number;
  rate?: number;
  /** Calls that completed, in any outcome. */
  requests: number;
  /**
   * With `rate` only (#2837): the calls the `1 / rate` grid called for over
   * the run's start window — the whole `--load-duration` on a run that ran
   * to it, or up to the last start of a run ended by `--load-requests`. A
   * slot nobody was free to take is
   * dropped rather than owed, so this can exceed what was started.
   */
  plannedStarts?: number;
  /** With `rate` only: `plannedStarts` minus the calls actually started. */
  droppedSlots?: number;
  /** With `rate` only: calls started per second over the start window. */
  achievedRate?: number;
  /**
   * `--load-open-loop` only (#2838): latencies are from each call's
   * scheduled start, and `droppedSlots` counts slots still waiting for a
   * worker when the window closed.
   */
  openLoop?: boolean;
  ok: number;
  /** Calls that returned a result with `isError: true`. */
  toolErrors: number;
  /** Calls that threw: protocol errors, timeouts, transport failures. */
  errors: number;
  /** `(toolErrors + errors) / requests` to four places; 0 when none completed. */
  errorRate: number;
  /**
   * Wall clock from the first start to the last completion. A run that ran
   * to its `--load-duration` is measured to the end of that window at least
   * (#2837), so a `--load-rate 1` run over 5s reports 1/s, not 1.25/s.
   */
  elapsedMs: number;
  /** Completed calls per second of wall clock, in any outcome. */
  throughput: number;
  /** Successful (`ok`) calls per second of wall clock (#2836). */
  okThroughput: number;
  /**
   * Latency of the successful (`ok`) calls only (#2836), so an instant
   * failure never makes a struggling server look faster. `null` when no call
   * succeeded.
   */
  latencyMs: LoadLatency | null;
  /** Latency of the failed calls, tool errors and thrown alike; `null` if none. */
  errorLatencyMs: LoadLatency | null;
  /** Thrown messages by frequency, at most {@link MAX_ERROR_KINDS} of them. */
  errorMessages: { message: string; count: number }[];
  /**
   * The first text block of each `isError` result (#2836), trimmed and cut to
   * {@link MAX_TOOL_ERROR_MESSAGE_LENGTH}, tallied like `errorMessages`.
   */
  toolErrorMessages: { message: string; count: number }[];
  /**
   * Present only when the run ended before its bounds did — interrupted, or
   * stopped by the circuit breaker (#2834, #2835). The counts cover what
   * completed before it stopped.
   */
  stoppedEarly?: LoadStop;
  /**
   * Present only when more than one connection was asked for, so a default
   * run's summary is exactly what it was before #2746.
   */
  connections?: LoadConnectionsSummary;
  /**
   * `--load-scenario` only (#2839): the same counts and latencies per step,
   * in scenario order. The top-level figures are the totals over every step.
   */
  steps?: LoadStepSummary[];
  /**
   * `--load-steps` / `--load-ramp` only (#2841): one full summary per stage
   * that ran, in order. The top-level counts and latencies are the totals
   * over every stage, `elapsedMs` the sum of theirs; the `--load-rate`
   * figures appear per stage only.
   */
  stages?: LoadStageSummary[];
  /**
   * `--load-interval` only (#2838): the run's calls bucketed by completion
   * time, one entry per interval from the start, empty intervals included.
   * A stepped run carries these per stage.
   */
  intervals?: LoadIntervalSummary[];
  /**
   * `--load-warmup` only (#2838): what the warm-up ran. None of it is in
   * any other figure. With `stoppedEarly`, the run ended during warm-up and
   * nothing was measured.
   */
  warmup?: LoadWarmupSummary;
  /** `--load-churn` only (#2912): the sessions the run opened and closed. */
  churn?: LoadChurnSummary;
  /** `--load-subscribe` only (#2913): how the notifications fanned out. */
  fanout?: LoadFanoutSummary;
  /** `--load-workers` only (#2914): the processes the run was spread over. */
  workers?: number;
};

/**
 * The sessions of a `--load-churn` run (#2912). Connecting happens after a
 * worker takes its slot but before its call is timed, so none of it is in
 * `latencyMs`; it is reported here instead. A session that failed to open
 * used up its slot, is counted in `failed`, and feeds the circuit breaker
 * like a thrown call, so a server refusing every session stops the run.
 * Warm-up sessions (`--load-warmup`) are included.
 */
export type LoadChurnSummary = {
  callsPerSession: number;
  /** Sessions that opened. */
  opened: number;
  /** Sessions that failed to open. */
  failed: number;
  /** Sessions whose close threw; the run carries on regardless. */
  closeFailed: number;
  /** Time to open each session, handshake included; `null` if none opened. */
  connectMs: LoadLatency | null;
  /** Connect failure messages by frequency, capped like `errorMessages`. */
  errorMessages: { message: string; count: number }[];
};

/** One bucket of a `--load-interval` time series (#2838). */
export type LoadIntervalSummary = {
  /** Bucket start and end, in ms from the start of the run. */
  startMs: number;
  endMs: number;
} & LoadOutcomeSummary;

/** The warm-up of a `--load-warmup` run (#2838). */
export type LoadWarmupSummary = {
  durationMs: number;
  requests: number;
  ok: number;
  failed: number;
  stoppedEarly?: LoadStop;
};

/**
 * One progress report (#2838): the totals so far, and the throughput and
 * successful-call latency over the last report interval.
 */
export type LoadProgress = {
  phase: "warmup" | "run";
  /** With stages: the 1-based stage running. */
  stage?: number;
  /** Since the phase (or stage) started. */
  elapsedMs: number;
  requests: number;
  ok: number;
  failed: number;
  /** Completions per second over the last interval. */
  throughput: number;
  /** p50 / p99 of the last interval's successful calls; `null` if none. */
  latencyMs: { p50: number; p99: number } | null;
};

/**
 * One measured call, as `--output` writes it (#2838): one NDJSON line each.
 * `startMs` is from the start of its window — the run, or its stage — and in
 * open-loop mode it is the call's scheduled start. Warm-up calls have none.
 */
export type LoadSample = {
  seq: number;
  worker: number;
  startMs: number;
  latencyMs: number;
  outcome: "ok" | "tool_error" | "error";
  /** The tool error's text, or the thrown message. */
  message?: string;
  /** With a scenario: the step's name. */
  step?: string;
  /** With stages: the 1-based stage. */
  stage?: number;
};

/** Receives each {@link LoadSample} as its call completes. */
export type LoadSampleSink = (sample: LoadSample) => void;

/** Where and how often a run reports progress. */
export type LoadProgressHook = {
  everyMs: number;
  emit: (progress: LoadProgress) => void;
};

/** One stage of a stepped run (#2841): its position, its level, its run. */
export type LoadStageSummary = {
  /** 1-based position in the run. */
  stage: number;
  stepBy: LoadStepBy;
  /** The stage's concurrency or rate, per `stepBy`. */
  level: number;
} & LoadSummary;

/** The outcome counts and latencies of a set of calls: a run, or one step. */
export type LoadOutcomeSummary = Pick<
  LoadSummary,
  | "requests"
  | "ok"
  | "toolErrors"
  | "errors"
  | "errorRate"
  | "throughput"
  | "okThroughput"
  | "latencyMs"
  | "errorLatencyMs"
  | "errorMessages"
  | "toolErrorMessages"
>;

/**
 * One scenario step's share of a run (#2839). `target` is what it calls —
 * the tool name, resource URI or prompt name. `toolErrors` is always 0 for a
 * `resources/read` or `prompts/get` step, which have no `isError` result.
 */
export type LoadStepSummary = {
  name: string;
  method: LoadScenarioMethod;
  target: string;
  weight: number;
} & LoadOutcomeSummary;

/**
 * How the connections of a multi-connection run (#2746) fared. Opening them
 * happens before the clock starts, so none of this is in `latencyMs`,
 * `elapsedMs` or `throughput`; and a connection that failed to open is counted
 * here, never as a call error, so `errorRate` still means calls only.
 */
export type LoadConnectionsSummary = {
  /** Connections asked for, the already-open one included. */
  requested: number;
  /** Connections the run actually spread its workers over. */
  opened: number;
  /** Extra connections that failed to open. */
  failed: number;
  /**
   * Time to open each extra connection (session setup, handshake included),
   * excluding the first, which the caller opened before the run. `null` when
   * no extra connection opened.
   */
  connectMs: LoadLatency | null;
  /** Connect failure messages by frequency, capped like `errorMessages`. */
  errorMessages: { message: string; count: number }[];
};

export const DEFAULT_LOAD_CONCURRENCY = 10;
/** One connection: every call over the session the caller opened. */
export const DEFAULT_LOAD_CONNECTIONS = 1;
/** Applied only when neither a duration nor a request count is given. */
export const DEFAULT_LOAD_DURATION_MS = 10_000;
/** `--load-churn`: calls per session when `--load-churn-calls` is not given. */
export const DEFAULT_LOAD_CHURN_CALLS = 1;

// The flag parsers live in `load-parsers.ts` so `load-thresholds.ts` can use
// them without importing this module (which imports it back, #2841).
export { positiveIntegerParser, positiveNumberParser } from "./load-parsers.js";

/**
 * Turn the raw flag values into {@link LoadOptions}, applying the defaults:
 * {@link DEFAULT_LOAD_CONCURRENCY} workers, and a
 * {@link DEFAULT_LOAD_DURATION_MS} window when no request count bounds the
 * run instead. Given both, the run stops at whichever is reached first.
 *
 * `concurrency` is the total across all connections, so it may not be below
 * `connections`: a connection with no worker would carry no calls and would
 * only inflate the session count the run claims to have tested.
 */
export function resolveLoadOptions(flags: {
  concurrency?: number;
  connections?: number;
  durationSec?: number;
  requests?: number;
  rate?: number;
  scenario?: LoadScenario;
  argRows?: LoadArgRows;
  /** From `resolveLoadStages`, which has already refused the conflicts. */
  stages?: LoadStages;
  /** `--load-interval` (#2838). */
  intervalSec?: number;
  /** `--load-warmup` (#2838). */
  warmupSec?: number;
  /** `--load-progress` (#2838); absent means no progress reports. */
  progressSec?: number;
  /** `--load-open-loop` (#2838). */
  openLoop?: boolean;
  /** `--load-churn` (#2912). */
  churn?: boolean;
  /** `--load-churn-calls` (#2912); needs `churn`. */
  churnCalls?: number;
  /** `--load-subscribe` (#2913). */
  subscribe?: string;
  /** `--load-subscribers` (#2913); needs `subscribe`. */
  subscribers?: number;
  /** `--load-subscribe-wait` (#2913); needs `subscribe`. */
  subscribeWaitSec?: number;
  /** `--load-workers` (#2914). */
  workers?: number;
}): LoadOptions {
  const { stages } = flags;
  assertFanoutFlags(flags);
  assertWorkerFlags(flags);
  if (flags.churnCalls !== undefined && flags.churn !== true) {
    throw new Error("--load-churn-calls requires --load-churn.");
  }
  // Churn opens its own sessions, one per worker at a time; a fixed pool of
  // `--load-connections` is the other model, and the two do not combine.
  if (flags.churn === true && flags.connections !== undefined) {
    throw new Error(
      "--load-churn cannot be combined with --load-connections; each worker opens its own sessions.",
    );
  }
  // Open loop follows the rate grid, so it needs one to follow.
  if (
    flags.openLoop === true &&
    flags.rate === undefined &&
    stages?.by !== "rate"
  ) {
    throw new Error(
      "--load-open-loop requires --load-rate (or --load-step-by rate).",
    );
  }
  // A warm-up before a staircase would run at which stage's level? The
  // stages are the ramp-up already, so the two are not combined.
  if (flags.warmupSec !== undefined && stages !== undefined) {
    throw new Error(
      "--load-warmup cannot be combined with --load-steps or --load-ramp; the first stage is the warm-up.",
    );
  }
  const durationMs =
    flags.durationSec !== undefined
      ? flags.durationSec * 1000
      : flags.requests === undefined && stages === undefined
        ? DEFAULT_LOAD_DURATION_MS
        : undefined;
  const steppedConcurrency = stages?.by === "concurrency";
  // Fan-out triggers run one at a time (#2913), so that is its default.
  const concurrency = steppedConcurrency
    ? Math.max(...stages.levels)
    : (flags.concurrency ??
      (flags.subscribe !== undefined ? 1 : DEFAULT_LOAD_CONCURRENCY));
  // Stepping concurrency, the smallest stage is the one with fewest workers.
  const fewestWorkers = steppedConcurrency
    ? Math.min(...stages.levels)
    : concurrency;
  if (flags.connections !== undefined && flags.connections > fewestWorkers) {
    throw new Error(
      steppedConcurrency
        ? `--load-connections (${flags.connections}) cannot exceed the smallest concurrency stage (${fewestWorkers}); every connection needs at least one worker.`
        : `--load-connections (${flags.connections}) cannot exceed --load-concurrency (${concurrency}); every connection needs at least one worker.`,
    );
  }
  return {
    concurrency,
    ...(flags.connections !== undefined && { connections: flags.connections }),
    ...(durationMs !== undefined && { durationMs }),
    ...(flags.requests !== undefined && { requests: flags.requests }),
    ...(flags.rate !== undefined && { rate: flags.rate }),
    ...(flags.scenario !== undefined && { scenario: flags.scenario }),
    ...(flags.argRows !== undefined && { argRows: flags.argRows }),
    ...(stages !== undefined && { stages }),
    ...(flags.intervalSec !== undefined && {
      intervalMs: flags.intervalSec * 1000,
    }),
    ...(flags.warmupSec !== undefined && {
      warmupMs: flags.warmupSec * 1000,
    }),
    ...(flags.progressSec !== undefined && {
      progressMs: flags.progressSec * 1000,
    }),
    ...(flags.openLoop === true && { openLoop: true }),
    ...(flags.churn === true && {
      churn: {
        callsPerSession: flags.churnCalls ?? DEFAULT_LOAD_CHURN_CALLS,
      },
    }),
    ...(flags.workers !== undefined &&
      flags.workers > 1 && { workers: flags.workers }),
    ...(flags.subscribe !== undefined && {
      fanout: {
        uri: flags.subscribe,
        subscribers: flags.subscribers ?? 1,
        settleMs:
          (flags.subscribeWaitSec ?? DEFAULT_LOAD_SUBSCRIBE_WAIT_SEC) * 1000,
      },
    }),
  };
}

/**
 * The `--load-workers` refusals (#2914). Each worker process runs its share
 * of one plain window and sends back mergeable totals, so the modes whose
 * results are per-stage, per-bucket or per-session — and would each need a
 * merge of their own — are not combined with it. Every process needs at
 * least one call in flight, and one to make.
 */
function assertWorkerFlags(flags: {
  workers?: number;
  concurrency?: number;
  requests?: number;
  connections?: number;
  stages?: LoadStages;
  intervalSec?: number;
  churn?: boolean;
  subscribe?: string;
}): void {
  const { workers } = flags;
  if (workers === undefined || workers <= 1) return;
  const conflicts = [
    ["--load-steps or --load-ramp", flags.stages !== undefined],
    ["--load-interval", flags.intervalSec !== undefined],
    ["--load-connections", flags.connections !== undefined],
    ["--load-churn", flags.churn === true],
    ["--load-subscribe", flags.subscribe !== undefined],
  ] as const;
  for (const [flag, given] of conflicts) {
    if (given) {
      throw new Error(`--load-workers cannot be combined with ${flag}.`);
    }
  }
  const concurrency = flags.concurrency ?? DEFAULT_LOAD_CONCURRENCY;
  if (concurrency < workers) {
    throw new Error(
      `--load-workers (${workers}) cannot exceed --load-concurrency (${concurrency}); every worker process needs at least one call in flight.`,
    );
  }
  if (flags.requests !== undefined && flags.requests < workers) {
    throw new Error(
      `--load-workers (${workers}) cannot exceed --load-requests (${flags.requests}); every worker process needs at least one call to make.`,
    );
  }
}

/** Default `--load-subscribe-wait` (#2913), in seconds. */
export const DEFAULT_LOAD_SUBSCRIBE_WAIT_SEC = 2;

/**
 * The `--load-subscribe` refusals (#2913). Its sessions are subscribers, not
 * workers, and each notification is matched to the trigger before it, so
 * the modes that add sessions, interleave triggers or discard calls do not
 * combine with it.
 */
function assertFanoutFlags(flags: {
  openLoop?: boolean;
  concurrency?: number;
  connections?: number;
  stages?: LoadStages;
  warmupSec?: number;
  churn?: boolean;
  subscribe?: string;
  subscribers?: number;
  subscribeWaitSec?: number;
}): void {
  if (flags.subscribe === undefined) {
    if (flags.subscribers !== undefined) {
      throw new Error("--load-subscribers requires --load-subscribe.");
    }
    if (flags.subscribeWaitSec !== undefined) {
      throw new Error("--load-subscribe-wait requires --load-subscribe.");
    }
    return;
  }
  const conflicts = [
    ["--load-connections", flags.connections !== undefined],
    ["--load-churn", flags.churn === true],
    ["--load-steps or --load-ramp", flags.stages !== undefined],
    ["--load-warmup", flags.warmupSec !== undefined],
    // Open loop times a call from its scheduled start, which would put the
    // wait for a worker into every notification's delivery latency.
    ["--load-open-loop", flags.openLoop === true],
  ] as const;
  for (const [flag, given] of conflicts) {
    if (given) {
      throw new Error(`--load-subscribe cannot be combined with ${flag}.`);
    }
  }
  if (flags.concurrency !== undefined && flags.concurrency > 1) {
    throw new Error(
      "--load-subscribe runs its triggers one at a time, so each notification is matched to the call that caused it; --load-concurrency must be 1.",
    );
  }
}

/** Distinct error messages kept; the rest fold into one `(other)` entry. */
export const MAX_ERROR_KINDS = 10;
export const OTHER_ERRORS = "(other)";
/**
 * Longest tool-error text kept (#2836). A tool's error text is a whole
 * result body, unlike a thrown message, and one tally entry per run should
 * not carry kilobytes of it.
 */
export const MAX_TOOL_ERROR_MESSAGE_LENGTH = 200;
/** Tallied for an `isError` result with no text block to report. */
export const NO_TOOL_ERROR_TEXT = "(no text content)";

/**
 * Circuit breaker (#2835). Once this many calls IN A ROW have thrown, the
 * run stops: a server that refuses every connection fails each call in
 * microseconds, and the rest of the window would otherwise be a flood of
 * instant failures that inflates throughput and deflates latency. Only
 * thrown calls count — a tool error is the server answering — and any other
 * outcome resets the streak.
 */
export const CIRCUIT_BREAKER_ERRORS = 50;
/**
 * The breaker also trips once calls have done nothing but throw for this
 * long, after at least {@link CIRCUIT_BREAKER_MIN_ERRORS} of them, so a slow
 * low-rate run against a dead server stops in about a second too.
 */
export const CIRCUIT_BREAKER_WINDOW_MS = 1000;
export const CIRCUIT_BREAKER_MIN_ERRORS = 5;

/**
 * The share of `--load-rate` below which {@link loadRateShortfallWarning}
 * speaks up (#2837).
 */
export const RATE_SHORTFALL_RATIO = 0.9;

/**
 * Slots claimed between forced yields to the event loop. Without
 * `--load-rate` nothing in the claim path waits on a timer, so calls that
 * settle without I/O (a client that rejects up front) would keep the run in
 * one unbroken microtask chain: no timer, socket close or other request gets
 * a turn until the run's bounds expire. Inside the mcpdo daemon that blocks
 * every connection, and the caller's own hang-up.
 */
export const YIELD_EVERY_SLOTS = 64;

/**
 * A macrotask turn: `setImmediate` in Node, and `setTimeout(0)` in a browser,
 * which has no `setImmediate` — the web client runs this engine there (#2911).
 * Looked up per call, not once at load, so either host gets its own.
 */
export const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof setImmediate === "function") setImmediate(resolve);
    else setTimeout(resolve, 0);
  });

/** Injected so tests can drive the clock instead of waiting on it. */
export type LoadClock = {
  now: () => number;
  /** A clock that can, should drop its timer when `signal` aborts. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export const realClock: LoadClock = {
  now: () => performance.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      // Cleared on abort, not left to fire: a `--load-rate 0.001` slot is a
      // 1000s timer, and a pending one keeps the process (the mcpdo daemon
      // during shutdown) alive until it fires.
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", cancel);
        resolve();
      }, ms);
      const cancel = (): void => {
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener("abort", cancel, { once: true });
    }),
};

/**
 * {@link LoadClock.sleep}, cut short when `signal` aborts, whether or not the
 * clock honors the signal itself, so a slow `--load-rate` slot never holds a
 * cancelled run open for a whole interval.
 */
export function sleepUnlessAborted(
  clock: LoadClock,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) return clock.sleep(ms);
  // An abort listener only hears a future abort; one already done ends the
  // sleep before it starts.
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      signal.removeEventListener("abort", done);
      resolve();
    };
    signal.addEventListener("abort", done, { once: true });
    void clock.sleep(ms, signal).then(done); // `sleep` never rejects
  });
}

function round(n: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(n * scale) / scale;
}

/**
 * Count thrown messages, keeping the first {@link MAX_ERROR_KINDS} distinct
 * ones seen. A failing server tends to fail the same way every time, but one
 * that embeds a request id in each message would otherwise grow the map by
 * one key per call for the whole run.
 */
export class ErrorTally {
  private readonly counts = new Map<string, number>();
  private other = 0;

  add(message: string): void {
    const count = this.counts.get(message);
    if (count !== undefined) this.counts.set(message, count + 1);
    else if (this.counts.size < MAX_ERROR_KINDS) this.counts.set(message, 1);
    else this.other++;
  }

  /** This tally's state, for merging into another (#2914). */
  snapshot(): ErrorTallySnapshot {
    return { counts: [...this.counts], other: this.other };
  }

  /** Fold another tally's {@link snapshot} in, under the same cap. */
  merge(other: ErrorTallySnapshot): void {
    for (const [message, count] of other.counts) {
      const mine = this.counts.get(message);
      if (mine !== undefined) this.counts.set(message, mine + count);
      else if (this.counts.size < MAX_ERROR_KINDS) {
        this.counts.set(message, count);
      } else this.other += count;
    }
    this.other += other.other;
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

/** An {@link ErrorTally}'s state, plain JSON (#2914). */
export type ErrorTallySnapshot = {
  counts: [string, number][];
  other: number;
};

/** An {@link OutcomeStats}'s state, plain JSON, for `--load-workers` (#2914). */
export type OutcomeSnapshot = {
  ok: number;
  toolErrors: number;
  errors: number;
  okLatencies: LatencySnapshot;
  errorLatencies: LatencySnapshot;
  tally: ErrorTallySnapshot;
  toolTally: ErrorTallySnapshot;
};

/**
 * What a measured window recorded, mergeable across `--load-workers`
 * processes (#2914): its totals and, with a scenario, each step's.
 */
export type LoadRawStats = {
  total: OutcomeSnapshot;
  steps?: OutcomeSnapshot[];
};

/**
 * The outcome counts, latencies and message tallies of a set of calls. A run
 * keeps one for its totals and, with a scenario (#2839), one per step.
 */
export class OutcomeStats {
  ok = 0;
  toolErrors = 0;
  errors = 0;
  // Bounded memory however long the run (#2838): see `LatencyRecorder`.
  private readonly okLatencies: LatencyRecorder;
  private readonly errorLatencies: LatencyRecorder;

  /**
   * `exactLimit` is lowered for the many small `--load-interval` buckets
   * and progress ticks, which go to their histogram sooner.
   */
  constructor(exactLimit?: number) {
    this.okLatencies = new LatencyRecorder(exactLimit);
    this.errorLatencies = new LatencyRecorder(exactLimit);
  }
  private readonly tally = new ErrorTally();
  private readonly toolTally = new ErrorTally();

  /** A call that produced a result, `isError` or not. */
  addResult(outcome: LoadCallOutcome, latency: number): void {
    if (outcome === "ok") {
      this.ok++;
      this.okLatencies.add(latency);
      return;
    }
    this.toolErrors++;
    this.errorLatencies.add(latency);
    this.toolTally.add(
      typeof outcome === "object" ? outcome.message : NO_TOOL_ERROR_TEXT,
    );
  }

  /** A call that threw. */
  addThrown(message: string, latency: number): void {
    this.errors++;
    this.errorLatencies.add(latency);
    this.tally.add(message);
  }

  /** Successful-call p50 and p99, or `null` with none (progress lines). */
  okPercentiles(): { p50: number; p99: number } | null {
    const l = this.okLatencies.summarize();
    return l === null ? null : { p50: l.p50, p99: l.p99 };
  }

  get completed(): number {
    return this.ok + this.toolErrors + this.errors;
  }

  /** This set's state, for merging into another (#2914). */
  snapshot(): OutcomeSnapshot {
    return {
      ok: this.ok,
      toolErrors: this.toolErrors,
      errors: this.errors,
      okLatencies: this.okLatencies.snapshot(),
      errorLatencies: this.errorLatencies.snapshot(),
      tally: this.tally.snapshot(),
      toolTally: this.toolTally.snapshot(),
    };
  }

  /** Fold another set's {@link snapshot} in. */
  merge(other: OutcomeSnapshot): void {
    this.ok += other.ok;
    this.toolErrors += other.toolErrors;
    this.errors += other.errors;
    this.okLatencies.merge(other.okLatencies);
    this.errorLatencies.merge(other.errorLatencies);
    this.tally.merge(other.tally);
    this.toolTally.merge(other.toolTally);
  }

  summarize(elapsedMs: number): LoadOutcomeSummary {
    const completed = this.completed;
    return {
      requests: completed,
      ok: this.ok,
      toolErrors: this.toolErrors,
      errors: this.errors,
      // Four places, so a rare failure under heavy load (23 in 41k) still shows.
      errorRate:
        completed === 0
          ? 0
          : round((this.toolErrors + this.errors) / completed, 4),
      throughput: elapsedMs > 0 ? round((completed * 1000) / elapsedMs) : 0,
      okThroughput: elapsedMs > 0 ? round((this.ok * 1000) / elapsedMs) : 0,
      latencyMs: this.okLatencies.summarize(),
      errorLatencyMs: this.errorLatencies.summarize(),
      errorMessages: this.tally.entries(),
      toolErrorMessages: this.toolTally.entries(),
    };
  }
}

/** The step picker for a scenario, or step 0 forever without one. */
function scenarioPicker(
  scenario: LoadScenario | undefined,
  shard?: { index: number; count: number },
): () => number {
  if (!scenario) return () => 0;
  const pick = createWeightedPicker(scenario.steps.map((s) => s.weight));
  if (shard === undefined) return pick;
  // A `--load-workers` process (#2914) takes every `count`-th pick of the one
  // weighted sequence, from its own `index`, so the processes together run
  // the mix one picker would — not `count` fresh cycles each skewed to the
  // heaviest steps.
  let skip = shard.index;
  return () => {
    for (; skip > 0; skip--) pick();
    skip = shard.count - 1;
    return pick();
  };
}

/** The {@link LoadStop} an abort reason names, or a plain interrupt. */
export function stopFromAbort(reason: unknown): LoadStop {
  return isLoadStop(reason)
    ? reason
    : { reason: "interrupted", detail: "the run was interrupted" };
}

/** Narrow an abort reason to a {@link LoadStop} a caller passed to `abort()`. */
function isLoadStop(value: unknown): value is LoadStop {
  if (typeof value !== "object" || value === null) return false;
  const { reason, detail } = value as Record<string, unknown>;
  return (
    (reason === "interrupted" ||
      reason === "connection_lost" ||
      reason === "consecutive_errors" ||
      reason === "threshold_breached") &&
    typeof detail === "string"
  );
}

/**
 * The message to tally for an `isError` result: its first text block,
 * trimmed and capped at {@link MAX_TOOL_ERROR_MESSAGE_LENGTH}.
 */
export function toolErrorText(content: unknown): string {
  const blocks = Array.isArray(content) ? (content as unknown[]) : [];
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const { type, text } = block as Record<string, unknown>;
    if (type !== "text" || typeof text !== "string") continue;
    const trimmed = text.trim();
    if (trimmed === "") continue;
    return trimmed.length > MAX_TOOL_ERROR_MESSAGE_LENGTH
      ? `${trimmed.slice(0, MAX_TOOL_ERROR_MESSAGE_LENGTH)}…`
      : trimmed;
  }
  return NO_TOOL_ERROR_TEXT;
}

/**
 * Envelope code for a `--load` flag combination either CLI refuses (#2834):
 * a `--load-*` flag without `--load`, `--load-connections` above
 * `--load-concurrency`, and the like. Exit 1 (`USAGE`) in both.
 */
export const LOAD_FLAG_CONFLICT = "load_flag_conflict";

/**
 * The stderr lines a front end prints after a load summary (#2835, #2837):
 * an early stop the caller did not ask for, and a missed `--load-rate`.
 * An `interrupted` run is left out — whoever interrupted it knows, and the
 * CLI says so in its exit envelope.
 */
export function loadSummaryWarnings(summary: LoadSummary): string[] {
  const warnings: string[] = [];
  const stop = summary.stoppedEarly;
  if (stop !== undefined && stop.reason !== "interrupted") {
    warnings.push(
      `Warning: the load run stopped early (${stop.reason}): ${stop.detail}.`,
    );
  }
  const shortfall = loadRateShortfallWarning(summary);
  if (shortfall !== undefined) warnings.push(shortfall);
  // A stepped run (#2841) carries its rate figures per stage.
  for (const stage of summary.stages ?? []) {
    const missed = loadRateShortfallWarning(stage);
    if (missed !== undefined) warnings.push(`Stage ${stage.stage}: ${missed}`);
  }
  return warnings;
}

/** Default `--load-progress` interval (#2838). */
export const DEFAULT_LOAD_PROGRESS_SEC = 5;

/**
 * One stderr progress line (#2838), the same in both CLIs:
 * `[load 12.0s] 1234 calls (1230 ok, 4 failed), 102.3/s, p50 12.1 / p99 40.2 ms`,
 * prefixed `warm-up` or `stage N` when that applies.
 */
export function formatLoadProgress(p: LoadProgress): string {
  const where =
    p.phase === "warmup"
      ? "warm-up "
      : p.stage !== undefined
        ? `stage ${p.stage} `
        : "";
  const latency =
    p.latencyMs === null
      ? "no successes"
      : `p50 ${p.latencyMs.p50} / p99 ${p.latencyMs.p99} ms`;
  return `[load ${where}${(p.elapsedMs / 1000).toFixed(1)}s] ${p.requests} calls (${p.ok} ok, ${p.failed} failed), ${p.throughput}/s, ${latency}`;
}

/**
 * The stderr warning for a `--load-rate` run that started well short of its
 * target (#2837), or `undefined` when it held the rate (or had none).
 * Slots nobody was free to take are dropped by design, which makes a
 * saturated run look healthy unless something says so.
 */
export function loadRateShortfallWarning(
  summary: LoadSummary,
): string | undefined {
  const { rate, achievedRate, plannedStarts, droppedSlots } = summary;
  if (
    rate === undefined ||
    plannedStarts === undefined ||
    droppedSlots === undefined ||
    plannedStarts === 0
  ) {
    return undefined;
  }
  // Judged on the exact counts rather than the two-place `achievedRate`,
  // which rounds a fractional `--load-rate` (0.014/s → 0.01/s) far enough to
  // read as a shortfall that never happened.
  const started = plannedStarts - droppedSlots;
  if (started >= plannedStarts * RATE_SHORTFALL_RATIO) return undefined;
  return `Warning: --load-rate ${rate}/s was not reached: ${started} of ${plannedStarts} planned calls started (${achievedRate}/s); ${droppedSlots} slots were dropped because every worker was busy. Raise --load-concurrency or lower --load-rate.`;
}

/**
 * Run `call` under the given bounds and summarize what happened. Each call is
 * handed the index of the worker making it (0 to `concurrency - 1`), which
 * {@link runLoadAcrossConnections} uses to pin a worker to a connection, and
 * the index of the scenario step to run — always 0 without a scenario. Steps
 * are picked in slot order by {@link createWeightedPicker}, so the mix of
 * calls *started* follows the weights exactly. Workers pull
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
 * calls are left to settle, and the summary covers what completed and says
 * why in `stoppedEarly`. Abort with a {@link LoadStop} as the reason to name
 * it; any other reason reports `interrupted`. The circuit breaker
 * ({@link CIRCUIT_BREAKER_ERRORS}) ends a run the same way on its own.
 */
export function runLoad(
  call: LoadCall,
  options: LoadOptions,
  clock: LoadClock = realClock,
  signal?: AbortSignal,
  progress?: LoadProgressHook,
  onSample?: LoadSampleSink,
  sessions?: LoadSessionHooks,
  observe?: LoadRunObserver,
): Promise<LoadSummary> {
  if (options.stages) {
    return runStages(
      call,
      options,
      options.stages,
      clock,
      signal,
      progress,
      onSample,
      sessions,
    );
  }
  if (options.warmupMs !== undefined) {
    return runWithWarmup(
      call,
      options,
      options.warmupMs,
      clock,
      signal,
      progress,
      onSample,
      sessions,
      observe,
    );
  }
  return runWindow(call, options, clock, signal, undefined, false, {
    hook: progress,
    phase: "run",
    ...(onSample && { onSample }),
    ...(sessions && { sessions }),
    ...(observe && { observe }),
  });
}

/**
 * What a `--load-workers` worker process (#2914) watches a run for: the
 * measured window's mergeable stats as it ends (`raw`), and the moment the
 * run stops early (`stop`) — reported as it happens, before in-flight calls
 * drain, so the parent can stop the other workers at once.
 */
export type LoadRunObserver = {
  raw?: (raw: LoadRawStats) => void;
  stop?: (stop: LoadStop) => void;
};

/**
 * A call's `{{seq}}` and `{{worker}}` in worker process `index` of `count`
 * (#2914): interleaved, so process 0 numbers 1, 1+count, … and process 1
 * numbers 2, 2+count, …, and none repeats another's. Unchanged without one.
 */
export function shardContext(
  seq: number,
  worker: number,
  shard: { index: number; count: number } | undefined,
): LoadCallContext {
  if (shard === undefined) return { seq, worker };
  return {
    seq: (seq - 1) * shard.count + shard.index + 1,
    worker: worker * shard.count + shard.index,
  };
}

/**
 * Per-worker session hooks (#2912): `prepare` runs after a worker takes its
 * slot and before its call is timed, `release` after the call is recorded,
 * so neither lands in a call's latency. A `prepare` that throws costs the
 * slot and counts toward the circuit breaker; `release` must not throw.
 */
export type LoadSessionHooks = {
  prepare: (worker: number) => Promise<void>;
  release: (worker: number) => Promise<void>;
};

/** Progress reporting for one window: where to send it, and its label. */
type WindowProgress = {
  hook: LoadProgressHook | undefined;
  phase: LoadProgress["phase"];
  stage?: number;
  /** `--output` samples (#2838); never set for a warm-up. */
  onSample?: LoadSampleSink;
  /**
   * Calls already numbered before this window (a warm-up, earlier stages),
   * so a sample's `seq` is the run-wide one `{{seq}}` saw.
   */
  seqOffset?: number;
  /** `--load-churn` session hooks (#2912). */
  sessions?: LoadSessionHooks;
  /** `--load-workers` (#2914): see {@link LoadRunObserver}. */
  observe?: LoadRunObserver;
  /**
   * Set to the slots this window numbered, once it ends. Not always its
   * `requests`: a `--load-churn` slot whose session failed to open (#2912)
   * took a `seq` and completed no call, so the next window (after a warm-up,
   * or the next stage) must count from here to keep `seq` unique.
   */
  numbered?: { slots: number };
};

/**
 * `--load-warmup` (#2838): a window of `warmupMs` at the run's own
 * concurrency and rate, whose calls are discarded, then the measured run.
 * The warm-up holds to its deadline so the measured window starts on time,
 * and `seq` keeps counting across the two. A warm-up that stops early — the
 * server is down, or the run was interrupted — ends the run there: the
 * measured window is started with that stop already in place, so it runs
 * nothing and reports the same reason.
 */
async function runWithWarmup(
  call: LoadCall,
  options: LoadOptions,
  warmupMs: number,
  clock: LoadClock,
  signal: AbortSignal | undefined,
  progress: LoadProgressHook | undefined,
  onSample: LoadSampleSink | undefined,
  sessions: LoadSessionHooks | undefined,
  observe: LoadRunObserver | undefined,
): Promise<LoadSummary> {
  const numbered = { slots: 0 };
  const warm = await runWindow(
    call,
    // No time series either: the warm-up's buckets would be built only to be
    // thrown away, at a cost that grows with the warm-up's length.
    {
      ...options,
      durationMs: warmupMs,
      requests: undefined,
      intervalMs: undefined,
    },
    clock,
    signal,
    undefined,
    true,
    {
      hook: progress,
      phase: "warmup",
      numbered,
      ...(sessions && { sessions }),
      // The stop only: a warm-up's stats are not the run's.
      ...(observe?.stop && { observe: { stop: observe.stop } }),
    },
  );
  const warmup: LoadWarmupSummary = {
    // What actually ran: shorter when it stopped early, longer when calls
    // drained past its deadline.
    durationMs: warm.elapsedMs,
    requests: warm.requests,
    ok: warm.ok,
    failed: warm.toolErrors + warm.errors,
    ...(warm.stoppedEarly !== undefined && {
      stoppedEarly: warm.stoppedEarly,
    }),
  };
  let measuredSignal = signal;
  if (warm.stoppedEarly !== undefined) {
    const stopped = new AbortController();
    stopped.abort(warm.stoppedEarly);
    measuredSignal = stopped.signal;
  }
  const offset = numbered.slots;
  const summary = await runWindow(
    (worker, step, seq) => call(worker, step, seq + offset),
    options,
    clock,
    measuredSignal,
    undefined,
    false,
    {
      hook: progress,
      phase: "run",
      seqOffset: offset,
      ...(onSample && { onSample }),
      ...(sessions && { sessions }),
      ...(observe && { observe }),
    },
  );
  return { ...summary, warmup };
}

/** One load call: the worker making it, its scenario step, its `seq`. */
export type LoadCall = (
  worker: number,
  step: number,
  seq: number,
) => Promise<LoadCallOutcome>;

/**
 * Accumulators a stepped run shares across its stages, so the totals cover
 * every call without re-reading each stage's latencies.
 */
type LoadSink = {
  total: OutcomeStats;
  steps?: OutcomeStats[];
  /**
   * The circuit breaker's streak, shared so a run of failures spanning a
   * stage boundary still trips it: short stages would otherwise each start
   * a fresh streak and never reach the limit.
   */
  breaker: BreakerState;
  /**
   * The scenario's step picker, shared for the same reason: a fresh picker
   * per stage restarts the weighted cycle, so a short stage could keep
   * picking the heaviest step and never reach a light one.
   */
  pickStep?: () => number;
};

/** The current streak of thrown calls, and when its first one completed. */
type BreakerState = { streak: number; since: number };

/** One window of load: the whole of an ordinary run, or one stage. */
async function runWindow(
  call: LoadCall,
  options: LoadOptions,
  clock: LoadClock,
  signal: AbortSignal | undefined,
  sink?: LoadSink,
  /**
   * Wait out the rest of `durationMs` after the last call settles (#2841).
   * A stage that is not the last sets it, so the next stage cannot start
   * early; an abort during the wait is recorded here like any other.
   */
  holdToDeadline = false,
  progress?: WindowProgress,
): Promise<LoadSummary> {
  const {
    concurrency,
    durationMs,
    requests,
    rate,
    scenario,
    intervalMs,
    openLoop,
  } = options;
  const total = new OutcomeStats();
  const stepRuns = scenario?.steps.map((step) => ({
    step,
    stats: new OutcomeStats(),
  }));
  const pickStep = sink?.pickStep ?? scenarioPicker(scenario, options.shard);
  let started = 0;
  // Calls actually started, for the `--load-rate` figures. Equal to `started`
  // except under `--load-churn` (#2912), where a slot whose session failed to
  // open, or opened after the deadline, numbered a `seq` but started no call.
  let callsStarted = 0;

  const start = clock.now();
  const deadline = durationMs === undefined ? Infinity : start + durationMs;
  const series =
    intervalMs !== undefined
      ? new IntervalSeries(start, intervalMs)
      : undefined;
  const ticker =
    progress?.hook !== undefined
      ? new ProgressTicker(progress.hook, clock, start, total, {
          phase: progress.phase,
          ...(progress.stage !== undefined && { stage: progress.stage }),
        })
      : undefined;
  const interval = rate === undefined ? 0 : 1000 / rate;
  // Earliest time the next slot may start.
  let nextStart = start;
  // When the latest call actually started. Open loop's `nextStart` is the
  // arrival schedule, which a saturated run lags far behind (#2838).
  let lastStartAt = start;

  // Everything inside the run watches `halt`, which the caller's `signal` and
  // the circuit breaker both trip, so either ends the run the same way.
  const halt = new AbortController();
  let stoppedEarly: LoadStop | undefined;
  let stoppedAt = 0;
  const stopRun = (stop: LoadStop): void => {
    if (stoppedEarly) {
      // An explicit interrupt outranks a breaker stop recorded while calls
      // were still draining, so Ctrl+C still exits 130; the stop time stays
      // the first one, which is when starts actually ended.
      if (stop.reason === "interrupted") stoppedEarly = stop;
      return;
    }
    stoppedEarly = stop;
    stoppedAt = clock.now();
    halt.abort();
    progress?.observe?.stop?.(stop);
  };
  const onAbort = (): void => {
    stopRun(stopFromAbort(signal?.reason));
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  // Circuit breaker state (#2835): the current streak of thrown calls, and
  // when the first of them completed.
  const breaker: BreakerState = sink?.breaker ?? { streak: 0, since: 0 };
  const noteThrown = (now: number): void => {
    if (breaker.streak++ === 0) breaker.since = now;
    const window = now - breaker.since;
    // Only while another call could still start: once the bounds have
    // ended starts, the failures are in-flight calls draining, and calling
    // that an early stop would misreport a run that ran to its bounds.
    // A stage with a later stage after it (`holdToDeadline`) always counts
    // as able to start more: its own last start may be behind it, but the
    // run is not over, so single-call stages could otherwise fail forever
    // without the breaker ever tripping.
    const canStart =
      holdToDeadline ||
      ((requests === undefined || started < requests) &&
        now < deadline &&
        nextStart < deadline);
    if (
      canStart &&
      (breaker.streak >= CIRCUIT_BREAKER_ERRORS ||
        (breaker.streak >= CIRCUIT_BREAKER_MIN_ERRORS &&
          window >= CIRCUIT_BREAKER_WINDOW_MS))
    ) {
      stopRun({
        reason: "consecutive_errors",
        // No server text here: it reaches stderr as a warning, and the
        // messages themselves are already tallied in `errorMessages`.
        detail: `${breaker.streak} calls in a row threw over ${round(window)}ms; the server looks unavailable`,
      });
    }
  };

  // FIFO turnstile: workers wanting a slot queue on a promise chain, and only
  // the one at the head waits on the clock. Without it, every idle worker
  // armed its own timer for the same slot and all but one re-armed on waking
  // — at concurrency 100 that is 99 wasted timers per call, enough to make
  // the generator the bottleneck at a high --load-rate.
  let turnstile: Promise<void> = Promise.resolve();

  /**
   * Wait for a slot and take it, returning the step it runs, or `undefined`
   * when the run is over. Only
   * the worker at the head of the turnstile is ever waiting on the clock, and
   * it claims a slot only once it is awake at that slot's time, re-checking
   * the bounds on every wake. So a timer that fires late — a stalled event
   * loop — starts one call, never a burst of everything that was due.
   */
  const claimSlot = async (): Promise<
    { step: number; seq: number; scheduledAt: number } | undefined
  > => {
    const ahead = turnstile;
    let release!: () => void;
    turnstile = new Promise((resolve) => (release = resolve));
    await ahead;
    try {
      // Yield while holding the turnstile: every other worker is queued
      // behind it, so the whole run pauses, not just this worker.
      if (started > 0 && started % YIELD_EVERY_SLOTS === 0) {
        await yieldToEventLoop();
      }
      for (;;) {
        if (halt.signal.aborted) return undefined;
        if (requests !== undefined && started >= requests) return undefined;
        const now = clock.now();
        if (now >= deadline) return undefined;
        const scheduled = Math.max(nextStart, now);
        if (scheduled >= deadline) return undefined;
        if (scheduled <= now) {
          started++;
          // The slot's own time: here it is never after `now`.
          const scheduledAt = nextStart;
          lastStartAt = now;
          // A wake that is merely late — timers always are, by a fraction of
          // a millisecond — keeps the slot grid, so the average rate holds.
          // Only a slot missed entirely (a stall longer than one interval)
          // is dropped, and spacing restarts from now: no catch-up burst.
          // Open loop (#2838) never drops one: the grid is the arrival
          // schedule, and a late slot runs as soon as a worker frees.
          nextStart =
            openLoop || now - nextStart < interval
              ? nextStart + interval
              : now + interval;
          // Picked while holding the turnstile, so the order is the slot
          // order whatever the workers' timing.
          return { step: pickStep(), seq: started, scheduledAt };
        }
        await sleepUnlessAborted(clock, scheduled - now, halt.signal);
      }
    } finally {
      release();
    }
  };

  // The fields every `--output` sample (#2838) shares.
  const sampleBase = (
    seq: number,
    worker: number,
    t0: number,
    latency: number,
  ): Pick<LoadSample, "seq" | "worker" | "startMs" | "latencyMs"> => ({
    seq: seq + (progress?.seqOffset ?? 0),
    worker,
    startMs: round(t0 - start),
    latencyMs: round(latency, 3),
  });
  const sampleWhere = (step: number): Pick<LoadSample, "step" | "stage"> => ({
    ...(scenario && { step: scenario.steps[step]!.name }),
    ...(progress?.stage !== undefined && { stage: progress.stage }),
  });

  const worker = async (index: number): Promise<void> => {
    for (;;) {
      const slot = await claimSlot();
      if (slot === undefined) return;
      const { step, seq, scheduledAt } = slot;
      // Another worker's call can abort the run between this worker taking
      // its slot and resuming here. The slot was never used, so it is handed
      // back: `started` feeds the `--load-rate` figures.
      if (halt.signal.aborted) {
        started--;
        return;
      }
      const sessions = progress?.sessions;
      if (sessions) {
        // `--load-churn` (#2912): open this worker's session, untimed. A
        // failed open spends the slot, and a server refusing every session
        // must still trip the breaker rather than spin on instant failures.
        try {
          await sessions.prepare(index);
        } catch {
          noteThrown(clock.now());
          continue;
        }
        if (halt.signal.aborted) {
          started--;
          return;
        }
        // A slow handshake can outlast the window (a stage's, a warm-up's).
        // The slot keeps its `seq` but starts no call; the session stays for
        // the next window or the final cleanup, and the next claim ends here.
        if (clock.now() >= deadline) continue;
      }
      const stats = stepRuns?.[step]?.stats;
      // Open loop times a call from its scheduled start, so the wait for a
      // free worker counts in its latency: that is the queueing it exposes.
      const t0 = openLoop ? scheduledAt : clock.now();
      callsStarted++;
      try {
        const outcome = await call(index, step, seq);
        const done = clock.now();
        const latency = done - t0;
        breaker.streak = 0;
        total.addResult(outcome, latency);
        series?.at(done).addResult(outcome, latency);
        ticker?.recent.addResult(outcome, latency);
        progress?.onSample?.({
          ...sampleBase(seq, index, t0, latency),
          ...(outcome === "ok"
            ? { outcome: "ok" }
            : {
                outcome: "tool_error",
                message:
                  typeof outcome === "object"
                    ? outcome.message
                    : NO_TOOL_ERROR_TEXT,
              }),
          ...sampleWhere(step),
        });
        stats?.addResult(outcome, latency);
        sink?.total.addResult(outcome, latency);
        sink?.steps?.[step]?.addResult(outcome, latency);
      } catch (err) {
        const now = clock.now();
        const message = err instanceof Error ? err.message : String(err);
        total.addThrown(message, now - t0);
        series?.at(now).addThrown(message, now - t0);
        ticker?.recent.addThrown(message, now - t0);
        progress?.onSample?.({
          ...sampleBase(seq, index, t0, now - t0),
          outcome: "error",
          message,
          ...sampleWhere(step),
        });
        stats?.addThrown(message, now - t0);
        sink?.total.addThrown(message, now - t0);
        sink?.steps?.[step]?.addThrown(message, now - t0);
        noteThrown(now);
      }
      if (sessions) await sessions.release(index);
    }
  };

  const ticking = ticker?.run();
  try {
    await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
    // A rate-limited window ends when its last start is due, which can be
    // well before its deadline. Waiting with `onAbort` still listening means
    // an interrupt here sets `stoppedEarly` and `stoppedAt`, so the window
    // reports the time that actually passed, not the padded window.
    if (holdToDeadline && !halt.signal.aborted && durationMs !== undefined) {
      const remaining = deadline - clock.now();
      if (remaining > 0)
        await sleepUnlessAborted(clock, remaining, halt.signal);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    ticker?.stop();
    await ticking;
  }

  const end = clock.now();
  const requestCapped = requests !== undefined && started >= requests;
  // Ran to its `--load-duration`: neither stopped early nor ended by the
  // request count. Measured to the end of that window at least (#2837).
  const ranFullWindow =
    durationMs !== undefined && stoppedEarly === undefined && !requestCapped;
  const elapsedMs = ranFullWindow
    ? Math.max(end - start, durationMs)
    : end - start;
  /**
   * When the run stopped starting calls, for the `--load-rate` figures: the
   * earliest of the bounds that applied. The duration deadline; for a run the
   * request count ended, the grid slot after its last start — the scheduler's
   * own `nextStart`, so a final timer that woke a little late does not count
   * as a missed slot; and the moment an early stop landed. So an interrupt
   * while calls drain past a bound does not stretch the window either.
   */
  const startWindowEnd = (): number => {
    let windowEnd = deadline;
    if (requestCapped) {
      // Open loop's arrival cursor can sit well before the starts it caused
      // (three 500 ms calls on a 10/s grid start at 0, 500 and 1000 ms with
      // the cursor at 300), so its window runs to the first grid slot after
      // the last actual start instead. Snapped to the grid, not `+ interval`
      // from it: a start a hair late (200.1 ms) must not stretch the window
      // to 300.1 and count a slot nobody missed.
      const after = openLoop
        ? Math.max(
            nextStart,
            start +
              (Math.floor((lastStartAt - start) / interval) + 1) * interval,
          )
        : nextStart;
      windowEnd = Math.min(windowEnd, after);
    }
    if (stoppedEarly !== undefined) windowEnd = Math.min(windowEnd, stoppedAt);
    /* v8 ignore next -- defensive: a run with no duration, no request cap
       and no stop never ends, so one of the three always applies. */
    return Number.isFinite(windowEnd) ? windowEnd : end;
  };
  if (progress?.numbered) progress.numbered.slots = started;
  progress?.observe?.raw?.({
    total: total.snapshot(),
    ...(stepRuns && { steps: stepRuns.map((r) => r.stats.snapshot()) }),
  });
  const totals = total.summarize(elapsedMs);
  return {
    concurrency,
    ...(durationMs !== undefined && { durationMs }),
    ...(requests !== undefined && { requestLimit: requests }),
    ...(openLoop === true && { openLoop: true }),
    ...(rate !== undefined &&
      rateFigures(rate, {
        started: callsStarted,
        windowMs: startWindowEnd() - start,
      })),
    // Spelled out rather than spread, to keep the summary's established key
    // order: `elapsedMs` sits between the counts and the throughputs.
    requests: totals.requests,
    ok: totals.ok,
    toolErrors: totals.toolErrors,
    errors: totals.errors,
    errorRate: totals.errorRate,
    elapsedMs: round(elapsedMs),
    throughput: totals.throughput,
    okThroughput: totals.okThroughput,
    latencyMs: totals.latencyMs,
    errorLatencyMs: totals.errorLatencyMs,
    errorMessages: totals.errorMessages,
    toolErrorMessages: totals.toolErrorMessages,
    ...(stoppedEarly !== undefined && { stoppedEarly }),
    ...(stepRuns && {
      steps: stepRuns.map(({ step, stats }) =>
        stepSummary(step, stats.summarize(elapsedMs)),
      ),
    }),
    ...(series && { intervals: series.summarize(elapsedMs) }),
  };
}

/** Exact samples per bucket before a bucket switches to its histogram. */
const BUCKET_EXACT_SAMPLES = 200;

/**
 * The `--load-interval` time series of one window (#2838): calls bucketed by
 * when they completed, each bucket its own small {@link OutcomeStats}.
 */
class IntervalSeries {
  private readonly buckets: OutcomeStats[] = [];

  constructor(start: number, intervalMs: number) {
    this.start = start;
    this.intervalMs = intervalMs;
  }

  private readonly start: number;
  private readonly intervalMs: number;

  /**
   * The bucket a call completing at `now` belongs to. Buckets are half-open,
   * `(start, end]`, so a call finishing exactly on a boundary counts in the
   * interval it finished, not in a zero-length one after it.
   */
  at(now: number): OutcomeStats {
    const index = Math.max(
      0,
      Math.ceil((now - this.start) / this.intervalMs) - 1,
    );
    while (this.buckets.length <= index) {
      this.buckets.push(new OutcomeStats(BUCKET_EXACT_SAMPLES));
    }
    return this.buckets[index]!;
  }

  /**
   * One entry per interval up to `elapsedMs`, empty ones included, so the
   * series has no gaps. The last may be shorter, and its rates use its own
   * length.
   */
  summarize(elapsedMs: number): LoadIntervalSummary[] {
    const count = Math.max(
      this.buckets.length,
      Math.ceil(elapsedMs / this.intervalMs),
    );
    return Array.from({ length: count }, (_, i) => {
      const startMs = i * this.intervalMs;
      // Unrounded for the rates: a call at 1000.001 ms in a 1000 ms series
      // opens a bucket that rounding would shrink to nothing, zeroing its
      // throughput. Only the reported offsets are rounded.
      const endMs = Math.max(
        startMs,
        Math.min(startMs + this.intervalMs, elapsedMs),
      );
      const bucket = this.buckets[i] ?? new OutcomeStats(0);
      return {
        startMs: round(startMs),
        endMs: round(endMs),
        ...bucket.summarize(endMs - startMs),
      };
    });
  }
}

/**
 * Progress reports for one window (#2838): every `everyMs`, the totals so
 * far plus the throughput and latency of the calls since the last report.
 */
class ProgressTicker {
  /** The calls completed since the last report. */
  recent = new OutcomeStats(BUCKET_EXACT_SAMPLES);
  private readonly done = new AbortController();
  private last: number;

  constructor(
    hook: LoadProgressHook,
    clock: LoadClock,
    start: number,
    total: OutcomeStats,
    label: Pick<LoadProgress, "phase" | "stage">,
  ) {
    this.hook = hook;
    this.clock = clock;
    this.start = start;
    this.total = total;
    this.label = label;
    this.last = start;
  }

  private readonly hook: LoadProgressHook;
  private readonly clock: LoadClock;
  private readonly start: number;
  private readonly total: OutcomeStats;
  private readonly label: Pick<LoadProgress, "phase" | "stage">;

  /** Report until {@link stop}; never rejects. */
  async run(): Promise<void> {
    for (;;) {
      await sleepUnlessAborted(this.clock, this.hook.everyMs, this.done.signal);
      if (this.done.signal.aborted) return;
      this.report();
    }
  }

  stop(): void {
    this.done.abort();
  }

  private report(): void {
    const now = this.clock.now();
    const span = now - this.last;
    const recent = this.recent;
    this.recent = new OutcomeStats(BUCKET_EXACT_SAMPLES);
    this.last = now;
    const { ok, toolErrors, errors, completed } = this.total;
    this.hook.emit({
      ...this.label,
      elapsedMs: round(now - this.start),
      requests: completed,
      ok,
      failed: toolErrors + errors,
      throughput: span > 0 ? round((recent.completed * 1000) / span) : 0,
      latencyMs: recent.okPercentiles(),
    });
  }
}

/**
 * `--load-steps` / `--load-ramp` (#2841): run each stage as its own window,
 * one after another, and summarize every stage plus the totals.
 *
 * - **`seq` keeps counting across stages**, so `{{seq}}` (#2840) stays unique
 *   for the whole run. Each window's started calls have all completed when it
 *   resolves, so its `requests` is exactly how many numbers it used.
 * - **Any early stop ends the run**: an interrupt, a lost connection, or the
 *   circuit breaker. With `stopOnBreach`, so does the first stage breaching a
 *   threshold, recorded as `stoppedEarly.reason: "threshold_breached"`.
 * - Connections (#2746) are opened once, by the caller, and serve every stage.
 */
async function runStages(
  call: LoadCall,
  options: LoadOptions,
  stages: LoadStages,
  clock: LoadClock,
  signal: AbortSignal | undefined,
  progress: LoadProgressHook | undefined,
  onSample: LoadSampleSink | undefined,
  sessions: LoadSessionHooks | undefined,
): Promise<LoadSummary> {
  const { scenario } = options;
  const sink: LoadSink = {
    total: new OutcomeStats(),
    breaker: { streak: 0, since: 0 },
    pickStep: scenarioPicker(scenario),
    ...(scenario && { steps: scenario.steps.map(() => new OutcomeStats()) }),
  };
  const rows: LoadStageSummary[] = [];
  let used = 0;
  let elapsedMs = 0;
  let stoppedEarly: LoadStop | undefined;
  for (const [i, level] of stages.levels.entries()) {
    const stageOptions: LoadOptions = {
      concurrency: stages.by === "concurrency" ? level : options.concurrency,
      durationMs: stages.stageMs,
      ...(stages.by === "rate"
        ? { rate: level }
        : options.rate !== undefined && { rate: options.rate }),
      ...(scenario && { scenario }),
      ...(options.intervalMs !== undefined && {
        intervalMs: options.intervalMs,
      }),
      ...(options.openLoop === true && { openLoop: true }),
    };
    const offset = used;
    const numbered = { slots: 0 };
    const summary = await runWindow(
      (worker, step, seq) => call(worker, step, seq + offset),
      stageOptions,
      clock,
      signal,
      sink,
      // Every stage but the last holds to its deadline, so the next one
      // neither starts early nor bursts at the boundary.
      i < stages.levels.length - 1,
      {
        hook: progress,
        phase: "run",
        stage: i + 1,
        seqOffset: offset,
        numbered,
        ...(onSample && { onSample }),
        ...(sessions && { sessions }),
      },
    );
    used += numbered.slots;
    elapsedMs += summary.elapsedMs;
    rows.push({ stage: i + 1, stepBy: stages.by, level, ...summary });
    if (summary.stoppedEarly) {
      stoppedEarly = summary.stoppedEarly;
      break;
    }
    const breaches = stages.stopOnBreach
      ? loadThresholdBreaches(summary, stages.stopOnBreach)
      : [];
    if (breaches.length > 0) {
      stoppedEarly = {
        reason: "threshold_breached",
        detail: `stage ${i + 1} (${stages.by} ${level}) breached a threshold: ${breaches.map((b) => b.message).join("; ")}`,
      };
      break;
    }
  }
  const totals = sink.total.summarize(elapsedMs);
  return {
    concurrency: options.concurrency,
    durationMs: stages.stageMs * stages.levels.length,
    requests: totals.requests,
    ok: totals.ok,
    toolErrors: totals.toolErrors,
    errors: totals.errors,
    errorRate: totals.errorRate,
    elapsedMs: round(elapsedMs),
    throughput: totals.throughput,
    okThroughput: totals.okThroughput,
    latencyMs: totals.latencyMs,
    errorLatencyMs: totals.errorLatencyMs,
    errorMessages: totals.errorMessages,
    toolErrorMessages: totals.toolErrorMessages,
    ...(stoppedEarly !== undefined && { stoppedEarly }),
    // `sink.steps` exists exactly when there is a scenario.
    ...(scenario && {
      steps: scenario.steps.map((step, i) =>
        stepSummary(step, sink.steps![i]!.summarize(elapsedMs)),
      ),
    }),
    ...(options.openLoop === true && { openLoop: true }),
    stages: rows,
  };
}

function stepSummary(
  step: LoadScenarioStep,
  outcomes: LoadOutcomeSummary,
): LoadStepSummary {
  return {
    name: step.name,
    method: step.method,
    target: loadStepTarget(step),
    weight: step.weight,
    ...outcomes,
  };
}

/**
 * `rate`, plus the planned-versus-started figures for a `--load-rate` run
 * (#2837), over `windowMs` — the span the run was starting calls in.
 */
function rateFigures(
  rate: number,
  run: { started: number; windowMs: number },
): Pick<
  LoadSummary,
  "rate" | "plannedStarts" | "droppedSlots" | "achievedRate"
> {
  const { started, windowMs } = run;
  // The slots at 0, 1/rate, … that fall inside the window. The epsilon keeps
  // floating-point noise (5000ms × 0.001/ms = 5.000000001) from adding one.
  const slots = Math.ceil((windowMs * rate) / 1000 - 1e-9);
  // Not capped at `--load-requests`: a request-bound run that was saturated
  // throughout still missed slots while it was starting its calls, and a cap
  // would report none. The limit bounds what is started, not the grid.
  const plannedStarts = Math.max(started, slots);
  return {
    rate,
    plannedStarts,
    droppedSlots: plannedStarts - started,
    achievedRate: windowMs > 0 ? round((started * 1000) / windowMs) : 0,
  };
}

/** The one thing every load connection must offer: a way to close it. */
export type LoadConnection = { disconnect: () => Promise<void> };

/**
 * Run {@link runLoad} with its workers spread over `options.connections`
 * connections: `primary` (already open, owned by the caller) plus extras made
 * by `openConnection`, which owns cleaning up after a connect it fails.
 *
 * - **All extras are opened before the clock starts**, concurrently, so
 *   session setup never lands in the call latencies. Their connect times are
 *   reported on their own, in `connections.connectMs`.
 * - **A connect failure does not abort the run** and is not a call error: the
 *   run goes ahead on the connections that did open, and the failures are
 *   counted in `connections.failed` — a server refusing its Nth session is
 *   exactly what a multi-connection run is for finding.
 * - **Worker `i` always uses connection `i % opened`**, so `concurrency` stays
 *   the total in flight and the calls split as evenly as the counts allow.
 * - **Every extra is disconnected in a `finally`**, settled independently, so
 *   one failing teardown neither hides another nor replaces the summary.
 *   `primary` is left open; it belongs to the caller.
 */
export async function runLoadAcrossConnections<C extends LoadConnection>(
  primary: C,
  openConnection: (() => Promise<C>) | undefined,
  callOn: (
    connection: C,
    step: number,
    ctx: LoadCallContext,
  ) => Promise<LoadCallOutcome>,
  options: LoadOptions,
  clock: LoadClock = realClock,
  signal?: AbortSignal,
  progress?: LoadProgressHook,
  onSample?: LoadSampleSink,
  onClosed?: (connection: C) => void,
  observe?: LoadRunObserver,
): Promise<LoadSummary> {
  // `--load-workers` (#2914): each process numbers its own calls and
  // workers, so they are spread to stay unique across the processes.
  const ctx = (seq: number, worker: number): LoadCallContext =>
    shardContext(seq, worker, options.shard);
  if (options.churn) {
    if (!openConnection) {
      throw new Error("--load-churn needs a way to open connections.");
    }
    return runChurnLoad(
      openConnection,
      callOn,
      options,
      options.churn.callsPerSession,
      clock,
      signal,
      progress,
      onSample,
      onClosed,
    );
  }
  const requested = options.connections ?? DEFAULT_LOAD_CONNECTIONS;
  if (requested <= 1) {
    return runLoad(
      (worker, step, seq) => callOn(primary, step, ctx(seq, worker)),
      options,
      clock,
      signal,
      progress,
      onSample,
      undefined,
      observe,
    );
  }
  if (!openConnection) {
    throw new Error(
      "--load-connections above 1 needs a way to open more connections.",
    );
  }
  const open = openConnection;
  const extras: C[] = [];
  const connectTimes: number[] = [];
  const tally = new ErrorTally();
  try {
    const attempts = await Promise.allSettled(
      Array.from({ length: requested - 1 }, async () => {
        const t0 = clock.now();
        const connection = await open();
        // Pushed as each one lands, so a connection that opened is closed in
        // the `finally` below even when a sibling's connect is still failing.
        extras.push(connection);
        connectTimes.push(clock.now() - t0);
      }),
    );
    for (const attempt of attempts) {
      if (attempt.status === "rejected") {
        const err: unknown = attempt.reason;
        tally.add(err instanceof Error ? err.message : String(err));
      }
    }
    const pool = [primary, ...extras];
    const summary = await runLoad(
      (worker, step, seq) =>
        callOn(pool[worker % pool.length]!, step, ctx(seq, worker)),
      options,
      clock,
      signal,
      progress,
      onSample,
    );
    return {
      ...summary,
      connections: {
        requested,
        opened: pool.length,
        failed: requested - pool.length,
        connectMs: summarizeLatency(connectTimes),
        errorMessages: tally.entries(),
      },
    };
  } finally {
    await Promise.allSettled(
      extras.map((c) => c.disconnect().finally(() => onClosed?.(c))),
    );
  }
}

/**
 * `--load-churn` (#2912): each worker opens a session with `openConnection`,
 * makes `callsPerSession` calls on it, closes it, and starts over, so the
 * server's session setup and teardown run under the same load as its calls.
 * Opening and closing happen outside each call's timing (see
 * {@link LoadSessionHooks}); connect times and failures go to `churn`.
 * Sessions still open when the run ends — a worker part-way through its
 * calls, or one stopped between connecting and calling — are closed in a
 * `finally`. The caller's own connection is not used for calls at all.
 */
async function runChurnLoad<C extends LoadConnection>(
  open: () => Promise<C>,
  callOn: (
    connection: C,
    step: number,
    ctx: LoadCallContext,
  ) => Promise<LoadCallOutcome>,
  options: LoadOptions,
  callsPerSession: number,
  clock: LoadClock,
  signal: AbortSignal | undefined,
  progress: LoadProgressHook | undefined,
  onSample: LoadSampleSink | undefined,
  onClosed: ((connection: C) => void) | undefined,
): Promise<LoadSummary> {
  const sessions = new Map<number, { connection: C; callsLeft: number }>();
  const connectTimes = new LatencyRecorder();
  const tally = new ErrorTally();
  let opened = 0;
  let failed = 0;
  let closeFailed = 0;
  const close = async (connection: C): Promise<void> => {
    try {
      await connection.disconnect();
    } catch {
      closeFailed++;
    } finally {
      onClosed?.(connection);
    }
  };
  const hooks: LoadSessionHooks = {
    prepare: async (worker) => {
      if (sessions.has(worker)) return;
      const t0 = clock.now();
      try {
        const connection = await open();
        connectTimes.add(clock.now() - t0);
        opened++;
        sessions.set(worker, { connection, callsLeft: callsPerSession });
      } catch (err) {
        failed++;
        tally.add(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    release: async (worker) => {
      const session = sessions.get(worker)!;
      if (--session.callsLeft > 0) return;
      sessions.delete(worker);
      await close(session.connection);
    },
  };
  const closeLeftovers = async (): Promise<void> => {
    const left = [...sessions.values()].map((s) => s.connection);
    sessions.clear();
    await Promise.allSettled(left.map(close));
  };
  try {
    const summary = await runLoad(
      (worker, step, seq) =>
        callOn(sessions.get(worker)!.connection, step, { seq, worker }),
      options,
      clock,
      signal,
      progress,
      onSample,
      hooks,
    );
    // Before the summary is built, so a leftover's failed close is counted.
    await closeLeftovers();
    return {
      ...summary,
      churn: {
        callsPerSession,
        opened,
        failed,
        closeFailed,
        connectMs: connectTimes.summarize(),
        errorMessages: tally.entries(),
      },
    };
  } finally {
    // The error path; after a normal run there is nothing left.
    await closeLeftovers();
  }
}

/**
 * Resolve `args.toolName` once, then load it with {@link runLoad}. The tool
 * lookup happens before the clock starts, so a missing tool fails the run
 * outright (exit 5, as a plain `tools/call` would) instead of being reported
 * as a 100% error rate. The lookup runs on `inspectorClient` alone, before
 * any extra connection is opened.
 *
 * With `options.connections` above one, `extra.openConnection` must return a
 * further CONNECTED client over the same server; see
 * {@link runLoadAcrossConnections} for how they are used and closed.
 */
export async function runToolLoad(
  inspectorClient: InspectorClient,
  args: MethodArgs,
  options: LoadOptions,
  extra: LoadRunExtras = {},
): Promise<LoadSummary> {
  if (!args.toolName) {
    throw new Error("--load requires --tool-name.");
  }
  const [tool] = await findTools(inspectorClient, args, [args.toolName]);
  // Values from the CLI's own parsers are never `undefined`, so the flag
  // arguments are strict JSON; the single cast narrows `JsonValue`'s
  // `undefined` away.
  const flagArgs = (args.toolArg ?? {}) as LoadArgsRow;
  const call = toolCaller(
    tool!,
    loadArgsTemplate(flagArgs, options.argRows),
    args,
    args.toolMeta,
  );
  const summary = await runLoadAcrossConnections(
    inspectorClient,
    extra.openConnection,
    (client, _step, ctx) => call(client, ctx),
    options,
    extra.clock,
    extra.signal,
    extra.progress,
    extra.onSample,
    extra.onConnectionClosed,
    extra.observe,
  );
  return { tool: tool!.name, ...summary };
}

/** What {@link runToolLoad} and {@link runScenarioLoad} take beyond a client. */
export type LoadRunExtras = {
  openConnection?: () => Promise<InspectorClient>;
  clock?: LoadClock;
  /** Ends the run early; see {@link runLoad}. */
  signal?: AbortSignal;
  /** Periodic progress reports (#2838); see {@link LoadProgressHook}. */
  progress?: LoadProgressHook;
  /** Each measured call, for `--output` (#2838). */
  onSample?: LoadSampleSink;
  /**
   * Told about each connection from `openConnection` once the engine has
   * closed it, so a caller tracking them (mcpdo's daemon) can let go of it
   * then rather than only when the run ends — a `--load-churn` run opens
   * one per session.
   */
  onConnectionClosed?: (connection: InspectorClient) => void;
  /** `--load-workers` (#2914): see {@link LoadRunObserver}. */
  observe?: LoadRunObserver;
};

/**
 * Run a `--load` invocation: {@link runScenarioLoad} when `options` carries a
 * scenario (#2839), otherwise {@link runToolLoad} on `args.toolName`. The one
 * entry point both CLIs call.
 */
export function runLoadTest(
  inspectorClient: InspectorClient,
  args: MethodArgs,
  options: LoadOptions,
  extra: LoadRunExtras = {},
): Promise<LoadSummary> {
  return options.scenario
    ? runScenarioLoad(inspectorClient, args, options, options.scenario, extra)
    : runToolLoad(inspectorClient, args, options, extra);
}

/**
 * `--load-scenario` (#2839): load a weighted mix of steps. Every tool a
 * `tools/call` step names is looked up once, before the clock starts, so a
 * missing one fails the run outright (exit 5, as with `--tool-name`) rather
 * than as one step's 100% error rate. A resource or prompt is not checked up
 * front — a server may serve URIs it does not list — so a bad one shows as
 * that step's errors. `args.metadata` (`--metadata`) applies to every step,
 * under each step's own `meta`.
 */
export async function runScenarioLoad(
  inspectorClient: InspectorClient,
  args: MethodArgs,
  options: LoadOptions,
  scenario: LoadScenario,
  extra: LoadRunExtras = {},
): Promise<LoadSummary> {
  const toolNames = scenario.steps.flatMap((s) =>
    s.method === "tools/call" ? [s.tool] : [],
  );
  const tools = new Map(
    (toolNames.length > 0
      ? await findTools(inspectorClient, args, toolNames)
      : []
    ).map((t) => [t.name, t]),
  );
  const callers = scenario.steps.map(
    (
      step,
    ): ((
      client: InspectorClient,
      ctx: LoadCallContext,
    ) => Promise<LoadCallOutcome>) => {
      const metadata = mergeStepMeta(args.metadata, step.meta);
      switch (step.method) {
        case "tools/call":
          // `meta` is the tool-specific `_meta`, as `--tool-metadata` is.
          return toolCaller(
            tools.get(step.tool)!,
            loadTemplateOrConstant(step.args ?? {}),
            args,
            step.meta,
          );
        case "resources/read": {
          const uri = loadTemplateOrConstant(step.uri);
          return async (client, ctx) => {
            // `"{{seq}}"` alone expands to a number; a URI is a string.
            await client.readResource(String(uri(ctx)), metadata);
            return "ok";
          };
        }
        case "prompts/get": {
          const promptArgs = loadTemplateOrConstant(step.args ?? {});
          return async (client, ctx) => {
            await client.getPrompt(step.prompt, promptArgs(ctx), metadata);
            return "ok";
          };
        }
      }
    },
  );
  return runLoadAcrossConnections(
    inspectorClient,
    extra.openConnection,
    (client, step, ctx) => callers[step]!(client, ctx),
    // The engine picks steps from `options.scenario`; set it from the
    // argument so the two can never disagree.
    { ...options, scenario },
    extra.clock,
    extra.signal,
    extra.progress,
    extra.onSample,
    extra.onConnectionClosed,
    extra.observe,
  );
}

/**
 * Look up every tool a run will call, and nothing else (#2914). A
 * `--load-workers` parent runs it under its auth recovery before forking, so
 * a server that needs a login (or a wider scope) to list its tools gets it
 * from the one interactive process, and a missing tool fails once, with exit
 * 5, rather than in every worker.
 */
export async function preflightLoadTools(
  inspectorClient: InspectorClient,
  args: MethodArgs,
  options: LoadOptions,
): Promise<void> {
  const names = options.scenario
    ? options.scenario.steps.flatMap((s) =>
        s.method === "tools/call" ? [s.tool] : [],
      )
    : args.toolName !== undefined
      ? [args.toolName]
      : [];
  if (names.length > 0) await findTools(inspectorClient, args, names);
}

/** `--metadata` under a step's own `meta`, or `undefined` when neither is set. */
function mergeStepMeta(
  general: RequestMetadata | undefined,
  step: RequestMetadata | undefined,
): RequestMetadata | undefined {
  if (step === undefined) return general;
  return { ...general, ...step };
}

/**
 * Look up each of `names` once, on `inspectorClient` alone, before the clock
 * starts and before any extra connection opens. A missing tool is exit 5
 * (`tool_not_found`), as a plain `tools/call` would be.
 */
async function findTools(
  inspectorClient: InspectorClient,
  args: MethodArgs,
  names: string[],
): Promise<Tool[]> {
  const toolsState = new ManagedToolsState(inspectorClient);
  let listed: Tool[];
  try {
    toolsState.setMetadata(args.metadata);
    await toolsState.refresh();
    listed = toolsState.getTools();
  } finally {
    toolsState.destroy();
  }
  return names.map((name) => {
    const found = listed.find((t) => t.name === name);
    if (!found) {
      throw new CliExitCodeError(
        EXIT_CODES.TOOL_ERROR,
        `Tool '${name}' not found on server.`,
        { code: "tool_not_found" },
      );
    }
    return found;
  });
}

/** One `tools/call` of `tool`, as a load call. */
function toolCaller(
  tool: Tool,
  toolArgs: LoadTemplate<LoadArgsRow>,
  args: MethodArgs,
  toolMeta: RequestMetadata | undefined,
): (client: InspectorClient, ctx: LoadCallContext) => Promise<LoadCallOutcome> {
  // Same rule as a single `tools/call` (#2649): a tool that requires task
  // support can only be called task-augmented.
  const useTask = tool.execution?.taskSupport === "required";
  return async (client, ctx) => {
    const params = [tool, toolArgs(ctx), args.metadata, toolMeta] as const;
    const invocation = useTask
      ? await client.callToolStream(...params)
      : await client.callTool(...params);
    /* v8 ignore next 3 -- defensive: `ToolCallInvocation.result` is nullable,
       but both call paths throw on failure rather than return a null result. */
    if (invocation.result === null) {
      throw new Error(invocation.error ?? "Tool call failed");
    }
    if (invocation.result.isError !== true) return "ok";
    return {
      outcome: "tool_error",
      message: toolErrorText(invocation.result.content),
    };
  };
}
