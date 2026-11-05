/**
 * The web load panel's pure half (#2911): turn what the user typed into the
 * shared `--load` engine's {@link LoadOptions}, and lay a {@link LoadSummary}
 * out as table rows. Nothing here touches the connection — running the engine
 * is `lib/loadTest.ts` — so every rule is testable with plain values.
 *
 * The options are built through the engine's own `resolveLoadStages` and
 * `resolveLoadOptions`, so a web run means exactly what the same settings
 * mean on the CLI (defaults, a stepped run's concurrency, a staircase's
 * levels). The form only offers combinations those resolvers accept — a
 * stepped run hides duration, requests and warm-up — so the messages users
 * see are this module's own, worded for the form rather than for CLI flags.
 */
import type { JsonValue } from "@inspector/core/mcp/index.js";
import {
  validateLoadScenario,
  type LoadScenario,
} from "@inspector/core/cli/handlers/load-scenario.js";
import {
  resolveLoadStages,
  type LoadStepBy,
} from "@inspector/core/cli/handlers/load-stages.js";
import {
  resolveLoadOptions,
  type LoadLatency,
  type LoadOptions,
  type LoadOutcomeSummary,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";

/** Load the selected tool with the form's arguments, or a pasted scenario. */
export type LoadTestTarget = "tool" | "scenario";

/**
 * The form's raw values. Number fields hold what Mantine's `NumberInput`
 * reports — a number, or `""` when the field is empty — so "not set" is
 * representable without a sentinel.
 */
export interface LoadTestFormValues {
  target: LoadTestTarget;
  /** Scenario JSON: an array of steps, or `{ "steps": [...] }`. */
  scenarioText: string;
  concurrency: number | string;
  durationSec: number | string;
  requests: number | string;
  rate: number | string;
  warmupSec: number | string;
  /** Comma-separated stage levels; empty for one ordinary window. */
  steps: string;
  stepBy: LoadStepBy;
  stepDurationSec: number | string;
}

export const DEFAULT_LOAD_TEST_FORM: LoadTestFormValues = {
  target: "tool",
  scenarioText: "",
  concurrency: 10,
  durationSec: 10,
  requests: "",
  rate: "",
  warmupSec: "",
  steps: "",
  stepBy: "concurrency",
  stepDurationSec: 10,
};

/** How often the panel asks the engine for a progress report. */
export const LOAD_TEST_PROGRESS_MS = 1000;

/** One run, ready for the engine: what to call and how hard. */
export interface LoadTestRequest {
  /** Set for a tool run; a scenario names its own targets. */
  toolName?: string;
  /** The tool's arguments, from the Tools form. */
  toolArgs?: Record<string, JsonValue>;
  options: LoadOptions;
}

export type LoadTestBuildResult =
  | { ok: true; request: LoadTestRequest }
  | { ok: false; error: string };

/** The selected tool and the arguments its form currently holds. */
export interface LoadTestTool {
  name: string;
  args: Record<string, unknown>;
}

/** Whether the form describes a stepped run (one stage per level). */
export function isSteppedLoad(values: LoadTestFormValues): boolean {
  return values.steps.trim() !== "";
}

/**
 * Read an optional positive number field. `undefined` when empty; throws a
 * form-worded message when the value is not a positive (whole, if asked)
 * number.
 */
function optionalPositive(
  value: number | string,
  label: string,
  whole = false,
): number | undefined {
  if (value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || (whole && !Number.isInteger(n))) {
    throw new Error(
      `${label} must be a positive ${whole ? "whole number" : "number"}.`,
    );
  }
  return n;
}

/** Parse the comma-separated stage levels. */
function parseSteps(text: string, stepBy: LoadStepBy): number[] {
  const levels = text.split(",").map((part) => {
    const trimmed = part.trim();
    return trimmed === "" ? NaN : Number(trimmed);
  });
  if (levels.some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new Error(
      "Steps must be a comma-separated list of positive numbers, e.g. 5,10,20.",
    );
  }
  if (stepBy === "concurrency" && levels.some((n) => !Number.isInteger(n))) {
    throw new Error("Steps must be whole numbers when stepping concurrency.");
  }
  return levels;
}

/** Parse the pasted scenario, prefixing the engine's message for the form. */
function parseScenario(text: string): LoadScenario {
  if (text.trim() === "") {
    throw new Error("Paste a scenario: an array of steps.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Scenario is not valid JSON: ${(err as Error).message}`, {
      cause: err,
    });
  }
  try {
    return validateLoadScenario(parsed);
  } catch (err) {
    throw new Error(`Scenario: ${(err as Error).message}`, { cause: err });
  }
}

/**
 * Build the engine request from the form, or say what is wrong with it.
 * `tool` is the Tools screen's selection; a tool run without one is refused.
 */
export function buildLoadTestRequest(
  values: LoadTestFormValues,
  tool: LoadTestTool | undefined,
): LoadTestBuildResult {
  try {
    const scenario =
      values.target === "scenario"
        ? parseScenario(values.scenarioText)
        : undefined;
    if (scenario === undefined && tool === undefined) {
      throw new Error("Select a tool to load, or paste a scenario.");
    }
    const concurrency = optionalPositive(
      values.concurrency,
      "Concurrency",
      true,
    );
    const rate = optionalPositive(values.rate, "Rate");
    const stepped = isSteppedLoad(values);
    let options: LoadOptions;
    if (stepped) {
      const stages = resolveLoadStages({
        steps: parseSteps(values.steps, values.stepBy),
        stepBy: values.stepBy,
        stepDurationSec: optionalPositive(
          values.stepDurationSec,
          "Step duration",
        ),
      });
      // The stages set the stepped level; the other knob is the form's own —
      // the worker pool when stepping the rate, the rate when stepping
      // concurrency.
      options = resolveLoadOptions({
        ...(values.stepBy === "rate" ? { concurrency } : { rate }),
        stages,
        scenario,
        progressSec: LOAD_TEST_PROGRESS_MS / 1000,
      });
    } else {
      options = resolveLoadOptions({
        concurrency,
        durationSec: optionalPositive(values.durationSec, "Duration"),
        requests: optionalPositive(values.requests, "Requests", true),
        rate,
        warmupSec: optionalPositive(values.warmupSec, "Warm-up"),
        scenario,
        progressSec: LOAD_TEST_PROGRESS_MS / 1000,
      });
    }
    return {
      ok: true,
      request:
        scenario !== undefined
          ? { options }
          : {
              toolName: tool!.name,
              // The Tools form's values are what a single Execute sends; the
              // same narrowing `onCallTool` applies at its own boundary.
              toolArgs: tool!.args as Record<string, JsonValue>,
              options,
            },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** One labelled figure in a summary table. */
export interface LoadFigure {
  label: string;
  value: string;
}

/** Milliseconds to one decimal place, with the unit. */
export function formatLoadMs(ms: number): string {
  return `${ms.toFixed(1)} ms`;
}

/** A per-second figure to one decimal place. */
export function formatLoadRate(perSec: number): string {
  return `${perSec.toFixed(1)}/s`;
}

/** An error rate (0..1) as a percentage. */
export function formatLoadPercent(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/** The headline figures of a run, in display order. */
export function loadOverviewFigures(summary: LoadSummary): LoadFigure[] {
  const figures: LoadFigure[] = [
    { label: "Requests", value: String(summary.requests) },
    { label: "OK", value: String(summary.ok) },
    { label: "Tool errors", value: String(summary.toolErrors) },
    { label: "Errors", value: String(summary.errors) },
    { label: "Error rate", value: formatLoadPercent(summary.errorRate) },
    { label: "Throughput", value: formatLoadRate(summary.throughput) },
    { label: "OK throughput", value: formatLoadRate(summary.okThroughput) },
    {
      label: "Elapsed",
      value: `${(summary.elapsedMs / 1000).toFixed(1)} s`,
    },
    { label: "Concurrency", value: String(summary.concurrency) },
  ];
  if (summary.rate !== undefined) {
    figures.push({
      label: "Target rate",
      value: formatLoadRate(summary.rate),
    });
  }
  if (summary.achievedRate !== undefined) {
    figures.push({
      label: "Achieved rate",
      value: formatLoadRate(summary.achievedRate),
    });
  }
  if (summary.droppedSlots !== undefined) {
    figures.push({
      label: "Dropped slots",
      value: String(summary.droppedSlots),
    });
  }
  return figures;
}

/** The latency columns every latency table shows, in order. */
export const LOAD_LATENCY_COLUMNS = [
  ["min", "Min"],
  ["mean", "Mean"],
  ["p50", "p50"],
  ["p90", "p90"],
  ["p95", "p95"],
  ["p99", "p99"],
  ["p999", "p99.9"],
  ["max", "Max"],
] as const satisfies readonly (readonly [keyof LoadLatency, string])[];

/** One latency distribution's cells, or dashes when there is none. */
export function loadLatencyCells(latency: LoadLatency | null): string[] {
  return LOAD_LATENCY_COLUMNS.map(([key]) =>
    latency === null ? "—" : formatLoadMs(latency[key]),
  );
}

/** One row of the per-step or per-stage breakdown. */
export interface LoadBreakdownRow {
  key: string;
  label: string;
  requests: string;
  ok: string;
  failed: string;
  errorRate: string;
  throughput: string;
  p50: string;
  p99: string;
}

function breakdownRow(
  key: string,
  label: string,
  s: LoadOutcomeSummary,
): LoadBreakdownRow {
  return {
    key,
    label,
    requests: String(s.requests),
    ok: String(s.ok),
    failed: String(s.toolErrors + s.errors),
    errorRate: formatLoadPercent(s.errorRate),
    throughput: formatLoadRate(s.throughput),
    p50: s.latencyMs === null ? "—" : formatLoadMs(s.latencyMs.p50),
    p99: s.latencyMs === null ? "—" : formatLoadMs(s.latencyMs.p99),
  };
}

/** A scenario run's per-step rows; empty for a single-tool run. */
export function loadStepRows(summary: LoadSummary): LoadBreakdownRow[] {
  return (summary.steps ?? []).map((step) =>
    breakdownRow(`step-${step.name}`, step.name, step),
  );
}

/** A stepped run's per-stage rows, labelled with each stage's level. */
export function loadStageRows(summary: LoadSummary): LoadBreakdownRow[] {
  return (summary.stages ?? []).map((stage) =>
    breakdownRow(
      `stage-${stage.stage}`,
      `Stage ${stage.stage} (${stage.stepBy} ${stage.level})`,
      stage,
    ),
  );
}

/** Thrown and tool-error messages by frequency, tagged with their kind. */
export interface LoadErrorTally {
  key: string;
  kind: "Error" | "Tool error";
  message: string;
  count: number;
}

export function loadErrorTallies(summary: LoadSummary): LoadErrorTally[] {
  return [
    ...summary.errorMessages.map(
      (e, i): LoadErrorTally => ({
        key: `error-${i}`,
        kind: "Error",
        ...e,
      }),
    ),
    ...summary.toolErrorMessages.map(
      (e, i): LoadErrorTally => ({
        key: `tool-error-${i}`,
        kind: "Tool error",
        ...e,
      }),
    ),
  ];
}
