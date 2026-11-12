import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ToolRun } from "../../../utils/toolRunHistory";
import { ToolRunDiff } from "./ToolRunDiff";

const meta: Meta<typeof ToolRunDiff> = {
  title: "Groups/ToolRunDiff",
  component: ToolRunDiff,
};

export default meta;
type Story = StoryObj<typeof ToolRunDiff>;

const run = (
  sequence: number,
  args: Record<string, unknown>,
  text: string,
  durationMs: number,
): ToolRun => ({
  id: `run-${sequence}`,
  sequence,
  toolName: "get_weather",
  args,
  startedAt: 0,
  durationMs,
  status: "ok",
  result: { content: [{ type: "text", text }] },
});

export const ChangedResult: Story = {
  args: {
    before: run(1, { city: "San Francisco" }, "65°F and sunny", 312),
    after: run(2, { city: "San Francisco" }, "68°F and foggy", 1240),
  },
};

export const ChangedArguments: Story = {
  args: {
    before: run(1, { city: "San Francisco" }, "65°F", 312),
    after: run(4, { city: "Oakland", units: "metric" }, "65°F", 290),
  },
};

export const NoDifferences: Story = {
  args: {
    before: run(1, { city: "San Francisco" }, "65°F", 312),
    after: run(2, { city: "San Francisco" }, "65°F", 298),
  },
};
