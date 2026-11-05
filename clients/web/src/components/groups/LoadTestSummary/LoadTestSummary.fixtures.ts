import type { LoadSummary } from "@inspector/core/cli/handlers/load-test.js";

/**
 * Load summaries for the panel's tests and stories (#2911), shaped as the
 * engine reports them.
 */
const LATENCY = {
  min: 1.2,
  mean: 4.8,
  p50: 4.1,
  p90: 7.9,
  p95: 9.3,
  p99: 14.6,
  p999: 21.4,
  max: 23.0,
};

export const TOOL_SUMMARY: LoadSummary = {
  tool: "echo",
  concurrency: 10,
  durationMs: 10_000,
  rate: 200,
  requests: 1987,
  plannedStarts: 2000,
  droppedSlots: 13,
  achievedRate: 198.7,
  ok: 1979,
  toolErrors: 5,
  errors: 3,
  errorRate: 0.004,
  elapsedMs: 10_012,
  throughput: 198.46,
  okThroughput: 197.66,
  latencyMs: LATENCY,
  errorLatencyMs: { ...LATENCY, p50: 2.2, p99: 3.1, max: 3.3 },
  errorMessages: [{ message: "Request timed out", count: 3 }],
  toolErrorMessages: [{ message: "rate limited", count: 5 }],
  warmup: { durationMs: 2000, requests: 390, ok: 390, failed: 0 },
};

const STEP_OUTCOME = {
  requests: 600,
  ok: 600,
  toolErrors: 0,
  errors: 0,
  errorRate: 0,
  throughput: 60,
  okThroughput: 60,
  latencyMs: LATENCY,
  errorLatencyMs: null,
  errorMessages: [],
  toolErrorMessages: [],
};

export const SCENARIO_SUMMARY: LoadSummary = {
  ...STEP_OUTCOME,
  requests: 900,
  ok: 900,
  concurrency: 4,
  durationMs: 15_000,
  elapsedMs: 15_004,
  throughput: 59.98,
  okThroughput: 59.98,
  steps: [
    {
      name: "tools/call echo",
      method: "tools/call",
      target: "echo",
      weight: 2,
      ...STEP_OUTCOME,
    },
    {
      name: "resources/read demo://resource/static/document/architecture.md",
      method: "resources/read",
      target: "demo://resource/static/document/architecture.md",
      weight: 1,
      ...STEP_OUTCOME,
      requests: 300,
      ok: 300,
      throughput: 20,
      okThroughput: 20,
    },
  ],
};

export const STAGED_SUMMARY: LoadSummary = {
  ...SCENARIO_SUMMARY,
  steps: undefined,
  tool: "echo",
  concurrency: 8,
  stages: [2, 4, 8].map((level, i) => ({
    stage: i + 1,
    stepBy: "concurrency" as const,
    level,
    concurrency: level,
    durationMs: 5000,
    elapsedMs: 5001,
    ...STEP_OUTCOME,
  })),
};

export const STOPPED_SUMMARY: LoadSummary = {
  ...TOOL_SUMMARY,
  warmup: undefined,
  rate: undefined,
  plannedStarts: undefined,
  droppedSlots: undefined,
  achievedRate: undefined,
  latencyMs: null,
  errorMessages: [],
  toolErrorMessages: [],
  stoppedEarly: { reason: "interrupted", detail: "the run was interrupted" },
};
