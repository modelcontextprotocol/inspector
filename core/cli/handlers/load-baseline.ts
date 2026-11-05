import { readFileSync } from "node:fs";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import { LOAD_FLAG_CONFLICT, type LoadSummary } from "./load-test.js";

/**
 * `--load-baseline <file>` (#2910): compare a finished `--load` run against
 * the summary of an earlier one, saved from `--format json`, and — with
 * `--load-max-regression <pct>` — fail the run when it is worse than that
 * baseline by more than the budget. So a CI job can gate on "no worse than
 * last release" without picking an absolute `--load-max-*` number and
 * re-tuning it as the server changes.
 *
 * Like `load-thresholds.ts`, this only judges a summary that already exists;
 * it never touches the engine, so both CLIs run it in their front end — mcpdo
 * included, where the run itself happens in the daemon. The baseline file is
 * read up front, before anything connects, so a bad path or a file that is
 * not a load summary fails in milliseconds rather than after the run.
 *
 * Four figures are compared, each in the direction that hurts:
 *
 * - **p50 and p99** of the successful calls: worse when higher, by the
 *   relative change from the baseline.
 * - **ok throughput** (successful calls per second): worse when lower, by
 *   the relative change.
 * - **error rate**: worse when higher, in **percentage points** rather than
 *   relative change. A healthy baseline's error rate is usually 0, and any
 *   relative change from 0 is infinite, so a relative budget would fail on a
 *   single failed call; `--load-max-error-rate` remains the absolute ceiling.
 *
 * Two summaries are only comparable when the runs were shaped alike — the
 * same tool or scenario, concurrency, bounds, rate, connections and stages.
 * A mismatch is reported (exit 1, `load_baseline_mismatch`) rather than
 * compared, since a regression measured between differently shaped runs
 * means nothing.
 */

/** Envelope code for a baseline file that cannot be read or is not a summary. */
export const LOAD_BASELINE_INVALID = "load_baseline_invalid";
/** Envelope code for a baseline from a differently shaped run. */
export const LOAD_BASELINE_MISMATCH = "load_baseline_mismatch";
/** Envelope code for a run worse than its baseline by more than the budget. */
export const LOAD_REGRESSION = "load_regression";

/** A baseline summary and where it came from, for messages. */
export type LoadBaseline = { source: string; summary: LoadSummary };

/** What a front end carries from the flags to the finished run. */
export type LoadBaselineGate = {
  baseline: LoadBaseline;
  /** `--load-max-regression`, in percent; absent means compare only. */
  maxRegressionPct?: number;
};

/**
 * Build the {@link LoadBaselineGate} from the raw flag values, reading the
 * baseline file, or `undefined` when no `--load-baseline` was given.
 * `--load-max-regression` alone has no baseline to measure against, so it is
 * a flag conflict rather than silently ignored.
 */
export function resolveLoadBaseline(flags: {
  baseline?: string;
  maxRegressionPct?: number;
}): LoadBaselineGate | undefined {
  if (flags.baseline === undefined) {
    if (flags.maxRegressionPct !== undefined) {
      throw new CliExitCodeError(
        EXIT_CODES.USAGE,
        "--load-max-regression requires --load-baseline.",
        { code: LOAD_FLAG_CONFLICT },
      );
    }
    return undefined;
  }
  return {
    baseline: readLoadBaselineFile(flags.baseline),
    ...(flags.maxRegressionPct !== undefined && {
      maxRegressionPct: flags.maxRegressionPct,
    }),
  };
}

/** A compared figure. */
export type LoadBaselineFigure = "p50" | "p99" | "errorRate" | "okThroughput";

/**
 * One figure of the comparison. `change` is the regression-signed change —
 * positive is worse — as a percentage for latency and throughput, and in
 * percentage points for the error rate, unrounded. `null` when there is
 * nothing to compare: the baseline had no successful call, or no throughput.
 * `Infinity` for a latency when the baseline had successes and this run none.
 */
export type LoadFigureComparison = {
  figure: LoadBaselineFigure;
  baseline: number | null;
  value: number | null;
  change: number | null;
};

/** The figures of one compared summary: the run, or one stage of it. */
export type LoadBaselineRow = {
  /** `""` for the run, ` at stage N (<stepBy> <level>)` for a stage. */
  where: string;
  figures: LoadFigureComparison[];
};

export type LoadBaselineComparison = {
  source: string;
  rows: LoadBaselineRow[];
};

/**
 * Commander-style parser for `--load-max-regression`: a percentage, with or
 * without a trailing `%` (`10`, `10%`, `2.5%`). `0` is allowed and means any
 * regression at all fails the run.
 */
export function maxRegressionParser(value: string): number {
  const trimmed = value.trim().replace(/%$/, "").trim();
  const n = trimmed === "" ? NaN : Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(
      "--load-max-regression must be a percentage of 0 or more, e.g. 10 or 10%.",
    );
  }
  return n;
}

function invalid(source: string, problem: string): CliExitCodeError {
  return new CliExitCodeError(
    EXIT_CODES.USAGE,
    `--load-baseline ${source}: ${problem}`,
    { code: LOAD_BASELINE_INVALID },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The counts and figures a summary must carry for this module to read it. */
const NUMERIC_FIELDS = [
  "concurrency",
  "requests",
  "ok",
  "toolErrors",
  "errors",
  "elapsedMs",
  "errorRate",
  "okThroughput",
] as const;

/** The problem with `value` as a load summary, or `undefined` if none. */
function summaryProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return "is not a JSON object";
  for (const field of NUMERIC_FIELDS) {
    if (typeof value[field] !== "number") {
      return `is not a --load summary (no numeric ${field}); save one with --format json`;
    }
  }
  const latency = value.latencyMs;
  if (
    latency !== null &&
    !(
      isRecord(latency) &&
      typeof latency.p50 === "number" &&
      typeof latency.p99 === "number"
    )
  ) {
    return "is not a --load summary (latencyMs is neither null nor a set of percentiles)";
  }
  if (value.stoppedEarly !== undefined && !isRecord(value.stoppedEarly)) {
    return "has a stoppedEarly field that is not an object";
  }
  if (value.steps !== undefined) {
    if (!Array.isArray(value.steps))
      return "has a steps field that is not an array";
    for (const step of value.steps as unknown[]) {
      if (
        !isRecord(step) ||
        typeof step.name !== "string" ||
        typeof step.method !== "string" ||
        typeof step.target !== "string" ||
        typeof step.weight !== "number"
      ) {
        return "has a scenario step without a name, method, target and weight";
      }
    }
  }
  if (value.stages !== undefined) {
    if (!Array.isArray(value.stages))
      return "has a stages field that is not an array";
    for (const stage of value.stages as unknown[]) {
      const problem = summaryProblem(stage);
      if (problem !== undefined) return `has a stage that ${problem}`;
    }
  }
  return undefined;
}

/**
 * Parse a baseline's text. Exported for tests and for callers that already
 * hold the text; {@link readLoadBaselineFile} is the usual entry point.
 */
export function parseLoadBaseline(text: string, source: string): LoadBaseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw invalid(
      source,
      `is not valid JSON (${err instanceof Error ? err.message : String(err)}); save the baseline with --format json`,
    );
  }
  // The one-shot CLI's `--format json` wraps its payload as `{ "result": … }`;
  // mcpdo's, and the CLI's piped default, print the summary bare. Both are
  // what `--format json` saved, so both are accepted.
  const candidate =
    isRecord(parsed) && isRecord(parsed.result) && !("requests" in parsed)
      ? parsed.result
      : parsed;
  const problem = summaryProblem(candidate);
  if (problem !== undefined) throw invalid(source, problem);
  // Checked above: the fields this module reads have the types it reads them as.
  const summary = candidate as LoadSummary;
  // A cut-short run measured part of a window; comparing a full run against
  // it would read every figure against the wrong denominator.
  if (summary.stoppedEarly !== undefined) {
    throw invalid(
      source,
      `the baseline run stopped early (${String(summary.stoppedEarly.reason)}), so it is not a baseline`,
    );
  }
  return { source, summary };
}

/** Read and validate a `--load-baseline` file. */
export function readLoadBaselineFile(path: string): LoadBaseline {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw invalid(
      path,
      `cannot be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseLoadBaseline(text, path);
}

/** How a summary's optional bound reads in a mismatch message. */
function shown(value: unknown): string {
  return value === undefined ? "unset" : JSON.stringify(value);
}

/**
 * The scenario's steps, reduced to what makes two runs comparable. Kept
 * structured, so no step name can collide with a delimiter.
 */
function stepsShape(
  summary: LoadSummary,
):
  | { name: string; method: string; target: string; weight: number }[]
  | undefined {
  return summary.steps?.map(({ name, method, target, weight }) => ({
    name,
    method,
    target,
    weight,
  }));
}

/**
 * The run-level fields that must match. Each entry is a label and the two
 * values, compared by their JSON form.
 */
function shapeDifferences(run: LoadSummary, base: LoadSummary): string[] {
  const pairs: [string, unknown, unknown][] = [
    ["tool", run.tool, base.tool],
    ["scenario steps", stepsShape(run), stepsShape(base)],
    ["concurrency", run.concurrency, base.concurrency],
    ["durationMs", run.durationMs, base.durationMs],
    ["requestLimit", run.requestLimit, base.requestLimit],
    ["rate", run.rate, base.rate],
    ["openLoop", run.openLoop === true, base.openLoop === true],
    [
      "connections",
      run.connections?.requested ?? 1,
      base.connections?.requested ?? 1,
    ],
    // `--load-subscribe` (#2913): what was subscribed to, by how many.
    [
      "fan-out",
      run.fanout && {
        uri: run.fanout.uri,
        subscribers: run.fanout.requested,
        mode: run.fanout.mode,
      },
      base.fanout && {
        uri: base.fanout.uri,
        subscribers: base.fanout.requested,
        mode: base.fanout.mode,
      },
    ],
    // `--load-churn` (#2912): calls per session, or unset without churn.
    [
      "churn calls per session",
      run.churn?.callsPerSession,
      base.churn?.callsPerSession,
    ],
  ];
  return pairs
    .filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b))
    .map(
      ([label, a, b]) =>
        `${label} is ${shown(a)} here but ${shown(b)} in the baseline`,
    );
}

/** Every reason `run` and `base` are not comparable; empty when they are. */
function mismatches(run: LoadSummary, base: LoadSummary): string[] {
  const found = shapeDifferences(run, base);
  const runStages = run.stages ?? [];
  const baseStages = base.stages ?? [];
  if ((run.stages === undefined) !== (base.stages === undefined)) {
    found.push(
      run.stages === undefined
        ? "the baseline is a stepped run (--load-steps / --load-ramp) and this one is not"
        : "this is a stepped run (--load-steps / --load-ramp) and the baseline is not",
    );
    return found;
  }
  const shared = Math.min(runStages.length, baseStages.length);
  for (let i = 0; i < shared; i++) {
    const r = runStages[i]!;
    const b = baseStages[i]!;
    if (
      r.stepBy !== b.stepBy ||
      r.level !== b.level ||
      r.durationMs !== b.durationMs
    ) {
      found.push(
        `stage ${r.stage} is ${r.stepBy} ${r.level} for ${shown(r.durationMs)}ms here but ${b.stepBy} ${b.level} for ${shown(b.durationMs)}ms in the baseline`,
      );
    }
    // A stepped run carries `--load-rate` per stage only, so a concurrency
    // staircase at 10/s and one at 100/s differ nowhere else.
    if (r.rate !== b.rate) {
      found.push(
        `stage ${r.stage} rate is ${shown(r.rate)} here but ${shown(b.rate)} in the baseline`,
      );
    }
  }
  // A run that stopped early (`--load-stop-on-breach`, an interrupt) ran
  // fewer stages than planned; the stages it did run still compare.
  if (
    runStages.length !== baseStages.length &&
    run.stoppedEarly === undefined
  ) {
    found.push(
      `this run has ${runStages.length} stages but the baseline has ${baseStages.length}`,
    );
  }
  return found;
}

/** Two places, for display only; judging uses the exact change. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Two places, or two significant figures below 0.01, so a small but real
 * change (a 0.0025-point error rate rise) never displays as 0.
 */
function shownNumber(n: number): number {
  return n !== 0 && Math.abs(n) < 0.01 ? Number(n.toPrecision(2)) : round2(n);
}

/**
 * Relative change in percent, positive when `value` is worse in the given
 * direction. Unrounded, so a budget of 0 still sees a tiny regression.
 */
function relativeChange(
  baseline: number,
  value: number,
  worseWhen: "higher" | "lower",
): number {
  const delta = worseWhen === "higher" ? value - baseline : baseline - value;
  return (delta / baseline) * 100;
}

/** Exact error rate from the counts; the summary's own is rounded (#2745). */
function exactErrorRate(s: LoadSummary): number {
  return s.requests === 0 ? 0 : (s.toolErrors + s.errors) / s.requests;
}

/** Exact ok calls per second; `okThroughput` is rounded to two places. */
function exactOkThroughput(s: LoadSummary): number {
  return s.elapsedMs > 0 ? (s.ok * 1000) / s.elapsedMs : 0;
}

function latencyFigure(
  figure: "p50" | "p99",
  run: LoadSummary,
  base: LoadSummary,
): LoadFigureComparison {
  const baseline = base.latencyMs?.[figure] ?? null;
  const value = run.latencyMs?.[figure] ?? null;
  // No successful call now, against a baseline that had some: the worst
  // possible regression, so it is reported as one rather than skipped.
  const change =
    baseline === null || baseline === 0
      ? null
      : value === null
        ? Infinity
        : relativeChange(baseline, value, "higher");
  return { figure, baseline, value, change };
}

function compareFigures(
  run: LoadSummary,
  base: LoadSummary,
): LoadFigureComparison[] {
  const baseRate = exactErrorRate(base);
  const runRate = exactErrorRate(run);
  const baseThroughput = exactOkThroughput(base);
  const runThroughput = exactOkThroughput(run);
  return [
    latencyFigure("p50", run, base),
    latencyFigure("p99", run, base),
    {
      figure: "errorRate",
      // Exact, not the summary's four-place `errorRate`: one failure in
      // 40 000 rounds to 0 there, and a budget of 0 that fails on it must
      // be able to say so.
      baseline: baseRate,
      value: runRate,
      // Percentage points, from the exact counts.
      change: (runRate - baseRate) * 100,
    },
    {
      figure: "okThroughput",
      baseline: base.okThroughput,
      value: run.okThroughput,
      change:
        baseThroughput > 0
          ? relativeChange(baseThroughput, runThroughput, "lower")
          : null,
    },
  ];
}

/**
 * Compare a finished run against its baseline. Throws
 * `load_baseline_mismatch` (exit 1) when the runs were shaped differently;
 * otherwise returns the figures, one row for the run, or one per stage for a
 * stepped run — each stage is its own load level, so the totals would mix
 * them, exactly as {@link checkLoadThresholds} judges stage by stage.
 */
export function compareLoadToBaseline(
  summary: LoadSummary,
  baseline: LoadBaseline,
): LoadBaselineComparison {
  const base = baseline.summary;
  const found = mismatches(summary, base);
  if (found.length > 0) {
    throw new CliExitCodeError(
      EXIT_CODES.USAGE,
      `--load-baseline ${baseline.source} is not comparable with this run: ${found.join("; ")}.`,
      { code: LOAD_BASELINE_MISMATCH },
    );
  }
  if (summary.stages !== undefined) {
    const baseStages = base.stages!;
    return {
      source: baseline.source,
      rows: summary.stages.map((stage, i) => ({
        where: ` at stage ${stage.stage} (${stage.stepBy} ${stage.level})`,
        figures: compareFigures(stage, baseStages[i]!),
      })),
    };
  }
  return {
    source: baseline.source,
    rows: [{ where: "", figures: compareFigures(summary, base) }],
  };
}

const FIGURE_LABEL: Record<LoadBaselineFigure, string> = {
  p50: "p50",
  p99: "p99",
  errorRate: "error rate",
  okThroughput: "ok throughput",
};

function figureValue(f: LoadFigureComparison, n: number | null): string {
  if (n === null) return "none";
  switch (f.figure) {
    case "p50":
    case "p99":
      return `${n}ms`;
    case "errorRate":
      return `${shownNumber(n * 100)}%`;
    case "okThroughput":
      return `${n}/s`;
  }
}

function changeText(f: LoadFigureComparison): string {
  if (f.change === null) return "not compared";
  if (f.change === Infinity) return "no call succeeded";
  const unit = f.figure === "errorRate" ? " pts" : "%";
  const sign = f.change > 0 ? "+" : "";
  return `${sign}${shownNumber(f.change)}${unit} worse`;
}

/** One figure as `p99 40ms -> 44ms (+10% worse)`. */
function figureLine(f: LoadFigureComparison): string {
  return `${FIGURE_LABEL[f.figure]} ${figureValue(f, f.baseline)} -> ${figureValue(f, f.value)} (${changeText(f)})`;
}

/**
 * The stderr lines a front end prints for a comparison: one per row, each
 * figure as baseline -> this run. A negative change is an improvement.
 */
export function formatLoadBaselineComparison(
  comparison: LoadBaselineComparison,
): string[] {
  return comparison.rows.map(
    (row) =>
      `Baseline ${comparison.source}${row.where}: ${row.figures.map(figureLine).join(", ")}`,
  );
}

/**
 * Floating-point slack on the budget: 1 ms -> 1.1 ms computes as
 * 10.000000000000009%, which must not fail a 10% budget. Far below any
 * regression a summary's rounded figures can express.
 */
const BUDGET_EPSILON = 1e-9;

/**
 * Fail the run (exit 10, `load_regression`) when any figure is worse than
 * the baseline by more than `maxRegressionPct` — percent for latency and
 * throughput, percentage points for the error rate. Every regressed figure
 * is named, with the baseline and the new value; a stepped run fails on its
 * first regressed stage.
 */
export function checkLoadRegression(
  comparison: LoadBaselineComparison,
  maxRegressionPct: number | undefined,
): void {
  if (maxRegressionPct === undefined) return;
  for (const row of comparison.rows) {
    const regressed = row.figures.filter(
      (f) => f.change !== null && f.change > maxRegressionPct + BUDGET_EPSILON,
    );
    if (regressed.length === 0) continue;
    throw new CliExitCodeError(
      EXIT_CODES.LOAD_THRESHOLD_EXCEEDED,
      `Load regression${row.where} against --load-baseline ${comparison.source}: ${regressed.map(figureLine).join("; ")}; over --load-max-regression ${maxRegressionPct}%.`,
      { code: LOAD_REGRESSION },
    );
  }
}
