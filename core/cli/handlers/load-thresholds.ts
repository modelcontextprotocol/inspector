import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import { positiveNumberParser } from "./load-parsers.js";
import type { LoadSummary } from "./load-test.js";

/**
 * Opt-in pass/fail thresholds for a `--load` run (#2745), so the exit code
 * carries the verdict and a CI job does not have to parse the summary with
 * `jq` to gate on it.
 *
 * Kept apart from `load-test.ts` on purpose: the engine measures and the
 * summary reports, while this module only *judges* a finished summary. That
 * keeps the comparison testable without driving any calls, and keeps it out
 * of `LoadOptions`, which bounds the run rather than grading it.
 *
 * A breach is raised only AFTER the caller has printed the full summary — the
 * numbers that failed the gate are exactly what someone reading the CI log
 * needs next to the exit code.
 *
 * Reads only the aggregate counts, `okThroughput` and the `latencyMs`
 * percentiles from {@link LoadSummary},
 * so fields added to the summary later do not change the verdict.
 */

/** Thresholds for one load run. An absent field is not checked. */
export type LoadThresholds = {
  /** Fail when the share of failed calls is above this fraction (0..1). */
  maxErrorRate?: number;
  /** Fail when the p50 latency, in milliseconds, is above this (#2838). */
  maxP50Ms?: number;
  /** Fail when the p95 latency, in milliseconds, is above this (#2838). */
  maxP95Ms?: number;
  /** Fail when the p99 latency, in milliseconds, is above this value. */
  maxP99Ms?: number;
  /** Fail when successful calls per second are below this (#2838). */
  minThroughput?: number;
};

/** Envelope code for an error rate above `--load-max-error-rate`. */
export const LOAD_ERROR_RATE_EXCEEDED = "load_error_rate_exceeded";
/** Envelope code for a p99 above `--load-max-p99` (or no p99 to compare). */
export const LOAD_P99_EXCEEDED = "load_p99_exceeded";
/** Envelope code for a p50 above `--load-max-p50` (#2838). */
export const LOAD_P50_EXCEEDED = "load_p50_exceeded";
/** Envelope code for a p95 above `--load-max-p95` (#2838). */
export const LOAD_P95_EXCEEDED = "load_p95_exceeded";
/** Envelope code for an ok throughput below `--load-min-throughput` (#2838). */
export const LOAD_THROUGHPUT_BELOW = "load_throughput_below";

/**
 * Commander-style parser for a fraction flag (`--load-max-error-rate`):
 * a finite number from 0 to 1 inclusive. `0` is allowed and means "any failed
 * call fails the run"; a percentage such as `5` is refused rather than read as
 * 500%, since that is the likeliest mistake.
 */
export function fractionParser(flag: string): (value: string) => number {
  return (value: string): number => {
    const n = value.trim() === "" ? NaN : Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new Error(`${flag} must be a number from 0 to 1.`);
    }
    return n;
  };
}

/** Parser for `--load-max-p99`: a positive number of milliseconds. */
export const maxP99Parser = positiveNumberParser("--load-max-p99");
/** Parser for `--load-max-p50` (#2838). */
export const maxP50Parser = positiveNumberParser("--load-max-p50");
/** Parser for `--load-max-p95` (#2838). */
export const maxP95Parser = positiveNumberParser("--load-max-p95");
/** Parser for `--load-min-throughput`: successful calls per second (#2838). */
export const minThroughputParser = positiveNumberParser(
  "--load-min-throughput",
);

/**
 * Build {@link LoadThresholds} from the raw flag values, or `undefined` when
 * none was given — so "no thresholds" stays a single, falsy case and a
 * run without them behaves exactly as before.
 */
export function resolveLoadThresholds(flags: {
  maxErrorRate?: number;
  maxP50Ms?: number;
  maxP95Ms?: number;
  maxP99Ms?: number;
  minThroughput?: number;
}): LoadThresholds | undefined {
  const entries = Object.entries(flags).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as LoadThresholds;
}

/** One threshold a summary failed: its envelope code and why. */
export type LoadBreach = { code: string; message: string };
type Breach = LoadBreach;

/**
 * The error rate is recomputed from the counts rather than read from
 * `errorRate`, which is rounded to four places for display: one failure in
 * 30 000 calls rounds to `0`, and `--load-max-error-rate 0` must still fail it.
 */
function exactErrorRate(summary: LoadSummary): number {
  return summary.requests === 0
    ? 0
    : (summary.toolErrors + summary.errors) / summary.requests;
}

function errorRateBreach(
  summary: LoadSummary,
  max: number,
): Breach | undefined {
  const rate = exactErrorRate(summary);
  if (rate <= max) return undefined;
  const failed = summary.toolErrors + summary.errors;
  return {
    code: LOAD_ERROR_RATE_EXCEEDED,
    message: `error rate ${summary.errorRate} (${failed} of ${summary.requests} calls failed) is above --load-max-error-rate ${max}`,
  };
}

/**
 * Judged on the successful calls only (#2836): `latencyMs` excludes failures,
 * so an instant failure can never pull the p99 under the SLO.
 */
/**
 * A latency percentile above its ceiling. Judged on the successful calls
 * only (#2836): `latencyMs` excludes failures, so an instant failure can
 * never pull a percentile under the SLO.
 */
function percentileBreach(
  summary: LoadSummary,
  key: "p50" | "p95" | "p99",
  max: number,
  code: string,
): Breach | undefined {
  const flag = `--load-max-${key}`;
  const value = summary.latencyMs?.[key];
  // No successful call means no latency to compare. Passing would let a run
  // that served nothing satisfy a latency SLO, so it fails — and says why.
  if (value === undefined) {
    return {
      code,
      message: `no call succeeded, so there is no ${key} latency to check against ${flag} ${max}`,
    };
  }
  if (value <= max) return undefined;
  return {
    code,
    message: `${key} latency ${value}ms is above ${flag} ${max}ms`,
  };
}

/** Successful calls per second below `--load-min-throughput` (#2838). */
function throughputBreach(
  summary: LoadSummary,
  min: number,
): Breach | undefined {
  if (summary.okThroughput >= min) return undefined;
  return {
    code: LOAD_THROUGHPUT_BELOW,
    message: `ok throughput ${summary.okThroughput}/s is below --load-min-throughput ${min}/s`,
  };
}

/**
 * Judge a finished summary. Returns normally when every set threshold holds
 * (or none is set); otherwise throws a {@link CliExitCodeError} with
 * `EXIT_CODES.LOAD_THRESHOLD_EXCEEDED`.
 *
 * Every breach is named in the message. The envelope `code` names the first,
 * checked in a fixed order — error rate, p50, p95, p99, then throughput — so a
 * CI job branching on
 * it sees a stable value when both fail.
 */
export function checkLoadThresholds(
  summary: LoadSummary,
  thresholds: LoadThresholds | undefined,
): void {
  if (!thresholds) return;
  // A stepped run (#2841) is judged stage by stage — each stage is its own
  // load level, and the totals mix them — and fails on the first stage that
  // breaches, naming it.
  const judged =
    summary.stages !== undefined
      ? summary.stages.map((stage) => ({
          where: ` at stage ${stage.stage} (${stage.stepBy} ${stage.level})`,
          summary: stage,
        }))
      : [{ where: "", summary }];
  for (const { where, summary: judgedSummary } of judged) {
    const breaches = loadThresholdBreaches(judgedSummary, thresholds);
    const [first] = breaches;
    if (!first) continue;
    throw new CliExitCodeError(
      EXIT_CODES.LOAD_THRESHOLD_EXCEEDED,
      `Load threshold exceeded${where}: ${breaches.map((b) => b.message).join("; ")}.`,
      { code: first.code },
    );
  }
}

/**
 * Every threshold `summary` fails, in the fixed order error rate, p50, p95,
 * p99, throughput;
 * empty when all hold. The non-throwing half of {@link checkLoadThresholds},
 * which the engine uses to stop a stepped run at its first breach (#2841).
 * Judges `summary`'s own counts only, never its `stages`.
 */
export function loadThresholdBreaches(
  summary: LoadSummary,
  thresholds: LoadThresholds,
): LoadBreach[] {
  const { maxErrorRate, maxP50Ms, maxP95Ms, maxP99Ms, minThroughput } =
    thresholds;
  // A fixed order, so the envelope code (the first breach) is stable.
  return [
    maxErrorRate !== undefined
      ? errorRateBreach(summary, maxErrorRate)
      : undefined,
    maxP50Ms !== undefined
      ? percentileBreach(summary, "p50", maxP50Ms, LOAD_P50_EXCEEDED)
      : undefined,
    maxP95Ms !== undefined
      ? percentileBreach(summary, "p95", maxP95Ms, LOAD_P95_EXCEEDED)
      : undefined,
    maxP99Ms !== undefined
      ? percentileBreach(summary, "p99", maxP99Ms, LOAD_P99_EXCEEDED)
      : undefined,
    minThroughput !== undefined
      ? throughputBreach(summary, minThroughput)
      : undefined,
  ].filter((b): b is Breach => b !== undefined);
}
