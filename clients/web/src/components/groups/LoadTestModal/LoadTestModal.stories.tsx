import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import type { LoadSummary } from "@inspector/core/cli/handlers/load-test.js";
import type { RunLoadTest } from "../../../lib/loadTest";
import { LoadTestModal } from "./LoadTestModal";
import { TOOL_SUMMARY } from "../LoadTestSummary/LoadTestSummary.fixtures";

/** A run that reports one progress line, then finishes with a fixture. */
const finishedRun: RunLoadTest = (_request, hooks) => {
  hooks.onProgress({
    phase: "run",
    elapsedMs: 1000,
    requests: 198,
    ok: 197,
    failed: 1,
    throughput: 198,
    latencyMs: { p50: 4.1, p99: 14.6 },
  });
  return Promise.resolve<LoadSummary>(TOOL_SUMMARY);
};

/** A run that never finishes, to show the progress state. */
const endlessRun: RunLoadTest = (_request, hooks) => {
  hooks.onProgress({
    phase: "run",
    elapsedMs: 4000,
    requests: 812,
    ok: 810,
    failed: 2,
    throughput: 201.5,
    latencyMs: { p50: 4.3, p99: 15.2 },
  });
  return new Promise<LoadSummary>(() => {});
};

const meta: Meta<typeof LoadTestModal> = {
  title: "Groups/LoadTestModal",
  component: LoadTestModal,
  args: {
    opened: true,
    tool: { name: "echo", args: { message: "hello" } },
    onRun: fn(finishedRun),
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof LoadTestModal>;

/** Opened from a tool, before a run. */
export const Default: Story = {};

/** No tool selected: only a pasted scenario can be run. */
export const ScenarioOnly: Story = { args: { tool: undefined } };

/** Start runs the engine; the summary replaces the progress line. */
export const Finished: Story = {
  play: async ({ userEvent }) => {
    // Modals render in a portal, so the body is the canvas here.
    const body = within(document.body);
    await userEvent.click(body.getByRole("button", { name: "Start" }));
    await expect(
      await body.findByRole("table", { name: "Overview" }),
    ).toBeInTheDocument();
  },
};

/** A run in flight: the form locks, and Stop is offered. */
export const Running: Story = {
  args: { onRun: fn(endlessRun) },
  play: async ({ userEvent }) => {
    const body = within(document.body);
    await userEvent.click(body.getByRole("button", { name: "Start" }));
    await expect(
      await body.findByRole("button", { name: "Stop" }),
    ).toBeInTheDocument();
    await expect(body.getByText(/812 calls/)).toBeInTheDocument();
  },
};
