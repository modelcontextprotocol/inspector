import { describe, expect, it } from "vitest";
import type { LoadSummary } from "@inspector/core/cli/handlers/load-test.js";
import {
  buildLoadTestRequest,
  DEFAULT_LOAD_TEST_FORM,
  formatLoadMs,
  formatLoadPercent,
  formatLoadRate,
  isSteppedLoad,
  loadErrorTallies,
  loadLatencyCells,
  loadOverviewFigures,
  loadStageRows,
  loadStepRows,
  type LoadTestFormValues,
} from "./loadTest";

const TOOL = { name: "echo", args: { message: "hi" }, argsReady: true };

function form(patch: Partial<LoadTestFormValues> = {}): LoadTestFormValues {
  return { ...DEFAULT_LOAD_TEST_FORM, ...patch };
}

function errorOf(values: LoadTestFormValues, tool = TOOL): string {
  const built = buildLoadTestRequest(values, tool);
  if (built.ok) throw new Error("expected the form to be refused");
  return built.error;
}

const LATENCY = {
  min: 1,
  mean: 2,
  p50: 2,
  p90: 3,
  p95: 3.5,
  p99: 4,
  p999: 4.5,
  max: 5,
};

const SUMMARY: LoadSummary = {
  tool: "echo",
  concurrency: 4,
  requests: 10,
  ok: 8,
  toolErrors: 1,
  errors: 1,
  errorRate: 0.2,
  elapsedMs: 2500,
  throughput: 4,
  okThroughput: 3.2,
  latencyMs: LATENCY,
  errorLatencyMs: null,
  errorMessages: [{ message: "boom", count: 1 }],
  toolErrorMessages: [{ message: "rate limited", count: 1 }],
};

describe("buildLoadTestRequest", () => {
  it("builds a tool run from the defaults", () => {
    expect(buildLoadTestRequest(form(), TOOL)).toEqual({
      ok: true,
      request: {
        toolName: "echo",
        toolArgs: { message: "hi" },
        options: { concurrency: 10, durationMs: 10_000, progressMs: 1000 },
      },
    });
  });

  it("carries requests, rate and warm-up, accepting numeric strings", () => {
    const built = buildLoadTestRequest(
      form({
        durationSec: "",
        requests: 50,
        rate: "2.5",
        warmupSec: 1,
        concurrency: "3",
      }),
      TOOL,
    );
    expect(built).toMatchObject({
      ok: true,
      request: {
        options: { concurrency: 3, requests: 50, rate: 2.5, warmupMs: 1000 },
      },
    });
    expect(built.ok && built.request.options.durationMs).toBeUndefined();
  });

  it("falls back to the engine's defaults when concurrency and duration are empty", () => {
    expect(
      buildLoadTestRequest(form({ concurrency: "", durationSec: "" }), TOOL),
    ).toMatchObject({
      ok: true,
      request: { options: { concurrency: 10, durationMs: 10_000 } },
    });
  });

  it("refuses a tool run with no tool selected", () => {
    expect(buildLoadTestRequest(form(), undefined)).toEqual({
      ok: false,
      error: "Select a tool to load, or paste a scenario.",
    });
  });

  it("refuses a tool run whose form arguments are not sendable", () => {
    expect(errorOf(form(), { ...TOOL, argsReady: false })).toMatch(
      /required arguments/,
    );
    // A scenario run does not use them.
    expect(
      buildLoadTestRequest(
        form({
          target: "scenario",
          scenarioText: '[{"method":"tools/call","tool":"echo"}]',
        }),
        { ...TOOL, argsReady: false },
      ).ok,
    ).toBe(true);
  });

  it("refuses a malformed placeholder in the tool arguments", () => {
    expect(
      errorOf(form(), { ...TOOL, args: { message: "{{rand:9-1}}" } }),
    ).toMatch(/^Tool arguments\.message: \{\{rand:9-1\}\}/);
  });

  it("ignores a field the stages override", () => {
    expect(
      buildLoadTestRequest(
        form({ steps: "1,2", stepBy: "rate", rate: 0 }),
        TOOL,
      ).ok,
    ).toBe(true);
    expect(
      buildLoadTestRequest(form({ steps: "1,2", concurrency: 0 }), TOOL).ok,
    ).toBe(true);
  });

  it("refuses non-positive and fractional values, naming the field", () => {
    expect(errorOf(form({ concurrency: 0 }))).toBe(
      "Concurrency must be a positive whole number.",
    );
    expect(errorOf(form({ concurrency: 1.5 }))).toMatch(/^Concurrency/);
    expect(errorOf(form({ rate: -1 }))).toBe("Rate must be a positive number.");
    expect(errorOf(form({ durationSec: "abc" }))).toMatch(/^Duration/);
  });

  it("builds a scenario run with no tool", () => {
    const built = buildLoadTestRequest(
      form({
        target: "scenario",
        scenarioText: '[{"method":"tools/call","tool":"echo"}]',
      }),
      undefined,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.toolName).toBeUndefined();
    expect(built.request.options.scenario?.steps[0]?.name).toBe(
      "tools/call echo",
    );
  });

  it("explains an empty, unparseable or invalid scenario", () => {
    expect(errorOf(form({ target: "scenario" }))).toMatch(/Paste a scenario/);
    expect(errorOf(form({ target: "scenario", scenarioText: "[" }))).toMatch(
      /^Scenario is not valid JSON/,
    );
    expect(errorOf(form({ target: "scenario", scenarioText: "[]" }))).toMatch(
      /^Scenario: a scenario needs at least one step/,
    );
  });

  it("steps concurrency: the levels set it, the rate still applies", () => {
    const built = buildLoadTestRequest(
      form({ steps: "2, 4", stepDurationSec: 3, rate: 5, concurrency: 99 }),
      TOOL,
    );
    expect(built).toMatchObject({
      ok: true,
      request: {
        options: {
          concurrency: 4,
          rate: 5,
          stages: { by: "concurrency", levels: [2, 4], stageMs: 3000 },
        },
      },
    });
    expect(built.ok && built.request.options.durationMs).toBeUndefined();
  });

  it("steps the rate over the form's worker pool", () => {
    expect(
      buildLoadTestRequest(
        form({ steps: "1.5,3", stepBy: "rate", concurrency: 6 }),
        TOOL,
      ),
    ).toMatchObject({
      ok: true,
      request: {
        options: {
          concurrency: 6,
          stages: { by: "rate", levels: [1.5, 3], stageMs: 10_000 },
        },
      },
    });
  });

  it("refuses malformed steps", () => {
    expect(errorOf(form({ steps: "1,,2" }))).toMatch(/comma-separated/);
    expect(errorOf(form({ steps: "0" }))).toMatch(/comma-separated/);
    expect(errorOf(form({ steps: "1.5" }))).toMatch(/whole numbers/);
  });
});

describe("isSteppedLoad", () => {
  it("is true only when steps hold text", () => {
    expect(isSteppedLoad(form())).toBe(false);
    expect(isSteppedLoad(form({ steps: "  " }))).toBe(false);
    expect(isSteppedLoad(form({ steps: "1" }))).toBe(true);
  });
});

describe("formatters", () => {
  it("formats milliseconds, rates and percentages", () => {
    expect(formatLoadMs(1.234)).toBe("1.2 ms");
    expect(formatLoadRate(3)).toBe("3.0/s");
    expect(formatLoadPercent(0.1234)).toBe("12.34%");
  });
});

describe("summary rows", () => {
  it("lists the headline figures, adding the rate figures when present", () => {
    const plain = loadOverviewFigures(SUMMARY);
    expect(plain.map((f) => f.label)).not.toContain("Target rate");
    expect(plain.find((f) => f.label === "Error rate")?.value).toBe("20.00%");
    expect(plain.find((f) => f.label === "Elapsed")?.value).toBe("2.5 s");
    const rated = loadOverviewFigures({
      ...SUMMARY,
      rate: 5,
      achievedRate: 4.5,
      droppedSlots: 2,
    });
    expect(rated.slice(-3)).toEqual([
      { label: "Target rate", value: "5.0/s" },
      { label: "Achieved rate", value: "4.5/s" },
      { label: "Dropped slots", value: "2" },
    ]);
  });

  it("renders a latency distribution, or dashes for none", () => {
    expect(loadLatencyCells(LATENCY)).toEqual([
      "1.0 ms",
      "2.0 ms",
      "2.0 ms",
      "3.0 ms",
      "3.5 ms",
      "4.0 ms",
      "4.5 ms",
      "5.0 ms",
    ]);
    expect(loadLatencyCells(null)).toEqual(Array(8).fill("—"));
  });

  it("builds per-step and per-stage rows", () => {
    expect(loadStepRows(SUMMARY)).toEqual([]);
    expect(loadStageRows(SUMMARY)).toEqual([]);
    const outcome = { ...SUMMARY, latencyMs: null };
    expect(
      loadStepRows({
        ...SUMMARY,
        steps: [
          {
            name: "tools/call echo",
            method: "tools/call",
            target: "echo",
            weight: 1,
            ...outcome,
          },
        ],
      }),
    ).toEqual([
      {
        key: "step-tools/call echo",
        label: "tools/call echo",
        requests: "10",
        ok: "8",
        failed: "2",
        errorRate: "20.00%",
        throughput: "4.0/s",
        p50: "—",
        p99: "—",
      },
    ]);
    expect(
      loadStageRows({
        ...SUMMARY,
        stages: [{ stage: 1, stepBy: "concurrency", level: 2, ...SUMMARY }],
      }),
    ).toMatchObject([
      { key: "stage-1", label: "Stage 1 (concurrency 2)", p99: "4.0 ms" },
    ]);
  });

  it("tallies thrown and tool errors together, tagged by kind", () => {
    expect(loadErrorTallies(SUMMARY)).toEqual([
      { key: "error-0", kind: "Error", message: "boom", count: 1 },
      {
        key: "tool-error-0",
        kind: "Tool error",
        message: "rate limited",
        count: 1,
      },
    ]);
  });
});
