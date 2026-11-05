import type { LoadThresholds } from "./load-thresholds.js";

/**
 * Stepped and ramped load for `--load` (#2841): a run made of consecutive
 * stages, each at its own load level, so the knee — where latency or errors
 * start climbing — shows in one run with one summary row per stage instead of
 * many runs stitched together by hand.
 *
 * This module plans the stages from the flags; `load-test.ts` runs them.
 *
 * - `--load-steps 10,25,50,100` runs one stage per level.
 * - `--load-ramp <from>:<to>:<sec>` is a staircase from `from` to `to` over
 *   `sec` seconds: `sec / --load-step-duration` stages (rounded, at least
 *   one) with levels spaced evenly from `from` to `to`, both included. A
 *   staircase rather than a continuous ramp, so every level has a stage long
 *   enough to measure and a row of its own.
 * - `--load-step-by` picks what the level is: `concurrency` (the default —
 *   calls in flight) or `rate` (calls started per second, over a worker pool
 *   of `--load-concurrency`).
 * - `--load-step-duration` is each stage's length (default 10s). With a ramp
 *   it is the target; the ramp's own duration is split evenly.
 * - `--load-stop-on-breach` ends the run after the first stage that breaches
 *   a `--load-max-*` threshold.
 */

export type LoadStepBy = "concurrency" | "rate";

/** The planned stages of a stepped run, carried in `LoadOptions.stages`. */
export type LoadStages = {
  by: LoadStepBy;
  /** One level per stage, in run order. */
  levels: number[];
  /** Each stage's length. */
  stageMs: number;
  /** Stop after the first stage breaching these (`--load-stop-on-breach`). */
  stopOnBreach?: LoadThresholds;
};

/** A `--load-ramp` before it is turned into stages. */
export type LoadRamp = { from: number; to: number; durationSec: number };

export const DEFAULT_LOAD_STEP_DURATION_SEC = 10;

/** Commander-style parser for `--load-steps`: comma-separated positive numbers. */
export function loadStepsParser(value: string): number[] {
  const parts = value.split(",").map((p) => p.trim());
  const levels = parts.map((p) => (p === "" ? NaN : Number(p)));
  if (
    levels.length === 0 ||
    levels.some((n) => !Number.isFinite(n) || n <= 0)
  ) {
    throw new Error(
      "--load-steps must be a comma-separated list of positive numbers, e.g. 10,25,50.",
    );
  }
  return levels;
}

/** Commander-style parser for `--load-ramp <from>:<to>:<sec>`. */
export function loadRampParser(value: string): LoadRamp {
  const parts = value.split(":").map((p) => p.trim());
  const [from, to, durationSec] = parts.map((p) =>
    p === "" ? NaN : Number(p),
  );
  if (
    parts.length !== 3 ||
    ![from, to, durationSec].every((n) => Number.isFinite(n) && n! > 0)
  ) {
    throw new Error(
      "--load-ramp must be <from>:<to>:<seconds>, three positive numbers, e.g. 10:100:60.",
    );
  }
  return { from: from!, to: to!, durationSec: durationSec! };
}

/** Commander-style parser for `--load-step-by`. */
export function loadStepByParser(value: string): LoadStepBy {
  if (value !== "concurrency" && value !== "rate") {
    throw new Error("--load-step-by must be concurrency or rate.");
  }
  return value;
}

/**
 * The levels of a ramp's stages: `count` levels spaced evenly from `from` to
 * `to`, both included (a single stage runs at `to`). Concurrency levels are
 * rounded to whole workers, at least one; a ramp too short to change level
 * between two stages repeats a level rather than skipping one. Rate levels
 * are kept exact.
 */
export function rampLevels(
  ramp: LoadRamp,
  count: number,
  by: LoadStepBy,
): number[] {
  const levels = Array.from({ length: count }, (_, i) =>
    count === 1
      ? ramp.to
      : ramp.from + ((ramp.to - ramp.from) * i) / (count - 1),
  );
  // A rate is used as given: rounding it would turn a valid low rate
  // (`0.0001:0.0004`) into a zero-rate stage.
  return by === "concurrency"
    ? levels.map((l) => Math.max(1, Math.round(l)))
    : levels;
}

/**
 * Plan the stages from the stage flags, or return `undefined` when neither
 * `--load-steps` nor `--load-ramp` is set. Throws an `Error` (which each CLI
 * reports as `load_flag_conflict`) for a combination that cannot mean one
 * thing: both shapes at once, a stage flag with neither, a fractional
 * concurrency step, a flag the stages would override.
 */
export function resolveLoadStages(flags: {
  steps?: number[];
  ramp?: LoadRamp;
  stepBy?: LoadStepBy;
  stepDurationSec?: number;
  stopOnBreach?: boolean;
  thresholds?: LoadThresholds;
  concurrency?: number;
  rate?: number;
  durationSec?: number;
  requests?: number;
}): LoadStages | undefined {
  const { steps, ramp } = flags;
  if (steps === undefined && ramp === undefined) {
    for (const [flag, value] of [
      ["--load-step-by", flags.stepBy],
      ["--load-step-duration", flags.stepDurationSec],
      ["--load-stop-on-breach", flags.stopOnBreach],
    ] as const) {
      if (value !== undefined) {
        throw new Error(`${flag} requires --load-steps or --load-ramp.`);
      }
    }
    return undefined;
  }
  if (steps !== undefined && ramp !== undefined) {
    throw new Error("--load-steps cannot be combined with --load-ramp.");
  }
  const shape = steps !== undefined ? "--load-steps" : "--load-ramp";
  if (flags.durationSec !== undefined || flags.requests !== undefined) {
    throw new Error(
      `${shape} cannot be combined with --load-duration or --load-requests; each stage runs for --load-step-duration.`,
    );
  }
  const by = flags.stepBy ?? "concurrency";
  // The stages set this level; a flag setting it too would be overridden.
  if (by === "concurrency" && flags.concurrency !== undefined) {
    throw new Error(
      `${shape} sets the concurrency of each stage, so it cannot be combined with --load-concurrency; use --load-step-by rate to step the rate over a fixed pool.`,
    );
  }
  if (by === "rate" && flags.rate !== undefined) {
    throw new Error(
      `${shape} with --load-step-by rate sets the rate of each stage, so it cannot be combined with --load-rate.`,
    );
  }
  if (
    by === "concurrency" &&
    steps !== undefined &&
    steps.some((n) => !Number.isInteger(n))
  ) {
    throw new Error(
      "--load-steps must be whole numbers when stepping concurrency.",
    );
  }
  if (flags.stopOnBreach === true && flags.thresholds === undefined) {
    throw new Error(
      "--load-stop-on-breach requires --load-max-error-rate or --load-max-p99.",
    );
  }
  const stepSec = flags.stepDurationSec ?? DEFAULT_LOAD_STEP_DURATION_SEC;
  let levels: number[];
  let stageMs: number;
  if (ramp !== undefined) {
    const count = Math.max(1, Math.round(ramp.durationSec / stepSec));
    levels = rampLevels(ramp, count, by);
    stageMs = (ramp.durationSec * 1000) / count;
  } else {
    levels = steps!;
    stageMs = stepSec * 1000;
  }
  return {
    by,
    levels,
    stageMs,
    ...(flags.stopOnBreach === true && { stopOnBreach: flags.thresholds }),
  };
}
