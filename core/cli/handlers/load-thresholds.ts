import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import { positiveNumberParser, type LoadSummary } from "./load-test.js";

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
 * Reads only the aggregate counts and `latencyMs.p99` from {@link LoadSummary},
 * so fields added to the summary later do not change the verdict.
 */

/** Thresholds for one load run. An absent field is not checked. */
export type LoadThresholds = {
  /** Fail when the share of failed calls is above this fraction (0..1). */
  maxErrorRate?: number;
  /** Fail when the p99 latency, in milliseconds, is above this value. */
  maxP99Ms?: number;
};

/** Envelope code for an error rate above `--load-max-error-rate`. */
export const LOAD_ERROR_RATE_EXCEEDED = "load_error_rate_exceeded";
/** Envelope code for a p99 above `--load-max-p99` (or no p99 to compare). */
export const LOAD_P99_EXCEEDED = "load_p99_exceeded";

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

/**
 * Build {@link LoadThresholds} from the raw flag values, or `undefined` when
 * neither flag was given — so "no thresholds" stays a single, falsy case and a
 * run without them behaves exactly as before.
 */
export function resolveLoadThresholds(flags: {
  maxErrorRate?: number;
  maxP99Ms?: number;
}): LoadThresholds | undefined {
  const { maxErrorRate, maxP99Ms } = flags;
  if (maxErrorRate === undefined && maxP99Ms === undefined) return undefined;
  return {
    ...(maxErrorRate !== undefined && { maxErrorRate }),
    ...(maxP99Ms !== undefined && { maxP99Ms }),
  };
}

type Breach = { code: string; message: string };

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

function p99Breach(summary: LoadSummary, max: number): Breach | undefined {
  const p99 = summary.latencyMs?.p99;
  // No completed call means no latency to compare. Passing would let a run
  // that measured nothing satisfy a latency SLO, so it fails — and says why.
  if (p99 === undefined) {
    return {
      code: LOAD_P99_EXCEEDED,
      message: `no call completed, so there is no p99 latency to check against --load-max-p99 ${max}`,
    };
  }
  if (p99 <= max) return undefined;
  return {
    code: LOAD_P99_EXCEEDED,
    message: `p99 latency ${p99}ms is above --load-max-p99 ${max}ms`,
  };
}

/**
 * Judge a finished summary. Returns normally when every set threshold holds
 * (or none is set); otherwise throws a {@link CliExitCodeError} with
 * `EXIT_CODES.LOAD_THRESHOLD_EXCEEDED`.
 *
 * Every breach is named in the message. The envelope `code` names the first,
 * checked in a fixed order — error rate, then p99 — so a CI job branching on
 * it sees a stable value when both fail.
 */
export function checkLoadThresholds(
  summary: LoadSummary,
  thresholds: LoadThresholds | undefined,
): void {
  if (!thresholds) return;
  const breaches = [
    thresholds.maxErrorRate !== undefined
      ? errorRateBreach(summary, thresholds.maxErrorRate)
      : undefined,
    thresholds.maxP99Ms !== undefined
      ? p99Breach(summary, thresholds.maxP99Ms)
      : undefined,
  ].filter((b): b is Breach => b !== undefined);
  const [first] = breaches;
  if (!first) return;
  throw new CliExitCodeError(
    EXIT_CODES.LOAD_THRESHOLD_EXCEEDED,
    `Load threshold exceeded: ${breaches.map((b) => b.message).join("; ")}.`,
    { code: first.code },
  );
}
