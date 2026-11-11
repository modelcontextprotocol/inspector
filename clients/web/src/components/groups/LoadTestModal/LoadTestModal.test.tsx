import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  act,
  renderWithMantine,
  screen,
  waitFor,
} from "../../../test/renderWithMantine";
import type {
  LoadProgress,
  LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import type { LoadTestHooks, RunLoadTest } from "../../../lib/loadTest";
import type { LoadTestRequest } from "../../../utils/loadTest";
import { LoadTestModal } from "./LoadTestModal";
import { TOOL_SUMMARY } from "../LoadTestSummary/LoadTestSummary.fixtures";

const TOOL = { name: "echo", args: { message: "hi" }, argsReady: true };

/** A run the test settles by hand, recording what it was given. */
function deferredRun() {
  const calls: { request: LoadTestRequest; hooks: LoadTestHooks }[] = [];
  let resolve!: (summary: LoadSummary) => void;
  let reject!: (err: unknown) => void;
  const onRun = vi.fn<RunLoadTest>((request, hooks) => {
    calls.push({ request, hooks });
    return new Promise<LoadSummary>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  return {
    onRun,
    calls,
    resolve: (s: LoadSummary) => resolve(s),
    reject: (e: unknown) => reject(e),
  };
}

const PROGRESS: LoadProgress = {
  phase: "run",
  elapsedMs: 2000,
  requests: 40,
  ok: 40,
  failed: 0,
  throughput: 20,
  latencyMs: { p50: 3, p99: 9 },
};

describe("LoadTestModal", () => {
  it("renders nothing while closed", () => {
    renderWithMantine(
      <LoadTestModal
        opened={false}
        tool={TOOL}
        onRun={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("runs the selected tool, shows progress, then the summary", async () => {
    const user = userEvent.setup();
    const run = deferredRun();
    renderWithMantine(
      <LoadTestModal opened tool={TOOL} onRun={run.onRun} onClose={vi.fn()} />,
    );
    expect(screen.getByText("Tool: echo")).toBeInTheDocument();
    expect(screen.getByText(/same engine as the CLI/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(run.calls[0]!.request).toMatchObject({
      toolName: "echo",
      toolArgs: { message: "hi" },
      options: { concurrency: 10, durationMs: 10_000 },
    });
    expect(screen.getByText("Starting…")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Concurrency" })).toBeDisabled();
    act(() => run.calls[0]!.hooks.onProgress(PROGRESS));
    expect(
      screen.getByText(/40 calls \(40 ok, 0 failed\)/),
    ).toBeInTheDocument();
    await act(async () => run.resolve(TOOL_SUMMARY));
    expect(
      await screen.findByRole("table", { name: "Overview" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("stops a run on Stop", async () => {
    const user = userEvent.setup();
    const run = deferredRun();
    renderWithMantine(
      <LoadTestModal opened tool={TOOL} onRun={run.onRun} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Start" }));
    const { signal } = run.calls[0]!.hooks;
    expect(signal.aborted).toBe(false);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(signal.aborted).toBe(true);
  });

  it("stops a run still going when the modal closes", async () => {
    const user = userEvent.setup();
    const run = deferredRun();
    const { rerender } = renderWithMantine(
      <LoadTestModal opened tool={TOOL} onRun={run.onRun} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Start" }));
    rerender(
      <LoadTestModal
        opened={false}
        tool={TOOL}
        onRun={run.onRun}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(run.calls[0]!.hooks.signal.aborted).toBe(true));
  });

  it("reports a run that failed", async () => {
    const user = userEvent.setup();
    const run = deferredRun();
    renderWithMantine(
      <LoadTestModal opened tool={TOOL} onRun={run.onRun} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Start" }));
    await act(async () => run.reject(new Error("Tool 'echo' not found")));
    expect(screen.getByText("Tool 'echo' not found")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start" }));
    await act(async () => run.reject("plain"));
    expect(screen.getByText("plain")).toBeInTheDocument();
  });

  it("offers only a scenario without a tool, and explains an invalid one", async () => {
    const user = userEvent.setup();
    const run = deferredRun();
    renderWithMantine(
      <LoadTestModal opened onRun={run.onRun} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("radio", { name: "Tool" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Paste a scenario/);
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    const input = screen.getByRole("textbox", { name: /Scenario/ });
    await user.click(input);
    await user.paste('[{"method":"tools/call","tool":"echo"}]');
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(run.calls[0]!.request.options.scenario?.steps).toHaveLength(1);
  });

  it("switches between a tool and a scenario", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <LoadTestModal opened tool={TOOL} onRun={vi.fn()} onClose={vi.fn()} />,
    );
    await user.click(screen.getByText("Scenario"));
    expect(
      screen.getByRole("textbox", { name: /Scenario/ }),
    ).toBeInTheDocument();
  });

  it("swaps the window fields for the step fields", async () => {
    const user = userEvent.setup();
    const run = deferredRun();
    renderWithMantine(
      <LoadTestModal opened tool={TOOL} onRun={run.onRun} onClose={vi.fn()} />,
    );
    await user.type(screen.getByLabelText("Requests"), "5");
    await user.type(screen.getByLabelText("Warm-up (s)"), "1");
    await user.clear(screen.getByLabelText("Duration (s)"));
    await user.type(screen.getByLabelText("Rate (calls/s)"), "4");
    await user.type(screen.getByLabelText("Steps"), "2,4");
    expect(screen.queryByLabelText("Duration (s)")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Concurrency" })).toBeDisabled();
    await user.clear(screen.getByLabelText("Step duration (s)"));
    await user.type(screen.getByLabelText("Step duration (s)"), "3");
    await user.click(screen.getByText("Rate"));
    expect(screen.queryByLabelText("Rate (calls/s)")).toBeNull();
    await user.clear(screen.getByRole("textbox", { name: "Concurrency" }));
    await user.type(screen.getByRole("textbox", { name: "Concurrency" }), "6");
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(run.calls[0]!.request.options).toMatchObject({
      concurrency: 6,
      stages: { by: "rate", levels: [2, 4], stageMs: 3000 },
    });
  });
});
