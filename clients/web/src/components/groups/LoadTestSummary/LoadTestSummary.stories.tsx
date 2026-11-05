import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoadTestSummary } from "./LoadTestSummary";
import {
  SCENARIO_SUMMARY,
  STAGED_SUMMARY,
  STOPPED_SUMMARY,
  TOOL_SUMMARY,
} from "./LoadTestSummary.fixtures";

const meta: Meta<typeof LoadTestSummary> = {
  title: "Groups/LoadTestSummary",
  component: LoadTestSummary,
  args: { summary: TOOL_SUMMARY },
};

export default meta;
type Story = StoryObj<typeof LoadTestSummary>;

/** A rate-limited tool run with a warm-up and a few errors of each kind. */
export const ToolRun: Story = {};

/** A weighted scenario: one row per step. */
export const Scenario: Story = { args: { summary: SCENARIO_SUMMARY } };

/** A stepped run: one row per stage. */
export const Stages: Story = { args: { summary: STAGED_SUMMARY } };

/** Stopped by the user before anything succeeded. */
export const Stopped: Story = { args: { summary: STOPPED_SUMMARY } };
