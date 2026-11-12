import { describe, expect, it } from "vitest";
import {
  renderWithMantine,
  screen,
  within,
} from "../../../test/renderWithMantine";
import { LoadTestSummary } from "./LoadTestSummary";
import {
  SCENARIO_SUMMARY,
  STAGED_SUMMARY,
  STOPPED_SUMMARY,
  TOOL_SUMMARY,
} from "./LoadTestSummary.fixtures";

describe("LoadTestSummary", () => {
  it("shows the overview, both latency rows, the warm-up and the errors", () => {
    renderWithMantine(<LoadTestSummary summary={TOOL_SUMMARY} />);
    const overview = within(screen.getByRole("table", { name: "Overview" }));
    expect(overview.getByText("1987")).toBeInTheDocument();
    expect(overview.getByText("0.40%")).toBeInTheDocument();
    expect(overview.getByText("Dropped slots")).toBeInTheDocument();
    const latency = within(screen.getByRole("table", { name: "Latency" }));
    expect(latency.getByText("p99.9")).toBeInTheDocument();
    expect(latency.getByText("14.6 ms")).toBeInTheDocument();
    expect(latency.getByText("3.1 ms")).toBeInTheDocument();
    expect(screen.getByText(/^Warm-up: 390 calls/)).toBeInTheDocument();
    const errors = within(screen.getByRole("table", { name: "Errors" }));
    expect(errors.getByText("Request timed out")).toBeInTheDocument();
    expect(errors.getByText("rate limited")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Steps" })).toBeNull();
    expect(screen.queryByRole("table", { name: "Stages" })).toBeNull();
    expect(screen.queryByText("Stopped early")).toBeNull();
  });

  it("adds a row per scenario step", () => {
    renderWithMantine(<LoadTestSummary summary={SCENARIO_SUMMARY} />);
    const steps = within(screen.getByRole("table", { name: "Steps" }));
    expect(steps.getByText("Step")).toBeInTheDocument();
    expect(steps.getByText("tools/call echo")).toBeInTheDocument();
    expect(steps.getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByRole("table", { name: "Errors" })).toBeNull();
  });

  it("adds a row per stage", () => {
    renderWithMantine(<LoadTestSummary summary={STAGED_SUMMARY} />);
    const stages = within(screen.getByRole("table", { name: "Stages" }));
    expect(stages.getByText("Stage")).toBeInTheDocument();
    expect(stages.getByText("Stage 3 (concurrency 8)")).toBeInTheDocument();
  });

  it("says a stopped run is partial, and dashes a latency with no calls", () => {
    renderWithMantine(<LoadTestSummary summary={STOPPED_SUMMARY} />);
    expect(screen.getByText("Stopped early")).toBeInTheDocument();
    const latency = within(screen.getByRole("table", { name: "Latency" }));
    expect(latency.getAllByText("—")).toHaveLength(8);
  });

  it("shows the engine's warnings for any other early stop", () => {
    renderWithMantine(
      <LoadTestSummary
        summary={{
          ...STOPPED_SUMMARY,
          stoppedEarly: {
            reason: "consecutive_errors",
            detail: "50 calls in a row threw",
          },
        }}
      />,
    );
    expect(screen.queryByText("Stopped early")).toBeNull();
    expect(
      screen.getByText(/stopped early \(consecutive_errors\)/),
    ).toBeInTheDocument();
  });
});
