import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "@mantine/core";
import { expect, fn, userEvent, within } from "storybook/test";
import type { ToolRun } from "../../../utils/toolRunHistory";
import { ToolRunHistoryPanel } from "./ToolRunHistoryPanel";

// Frame the panel in the card the Tools screen puts it in.
const inCardDecorators: Decorator[] = [
  (Story) => (
    <Card withBorder padding="lg" variant="preview" maw={560}>
      <Story />
    </Card>
  ),
];

const meta: Meta<typeof ToolRunHistoryPanel> = {
  title: "Groups/ToolRunHistoryPanel",
  component: ToolRunHistoryPanel,
  args: {
    isExecuting: false,
    onRerun: fn(),
  },
  decorators: inCardDecorators,
};

export default meta;
type Story = StoryObj<typeof ToolRunHistoryPanel>;

const START = Date.UTC(2026, 10, 5, 14, 0, 0);

const weatherRun = (
  sequence: number,
  city: string,
  temperature: number,
  durationMs: number,
): ToolRun => ({
  id: `run-${sequence}`,
  sequence,
  toolName: "get_weather",
  args: { city },
  startedAt: START + sequence * 60_000,
  durationMs,
  status: "ok",
  result: {
    content: [{ type: "text", text: `${city}: ${temperature}°F` }],
    structuredContent: { city, temperature, unit: "fahrenheit" },
  },
});

const runs: ToolRun[] = [
  {
    id: "run-3",
    sequence: 3,
    toolName: "get_weather",
    args: { city: "Atlantis" },
    startedAt: START + 3 * 60_000,
    durationMs: 41,
    status: "error",
    error: "MCP error -32602: Invalid params: unknown city 'Atlantis'",
    errorCode: -32602,
  },
  weatherRun(2, "San Francisco", 68, 1240),
  weatherRun(1, "San Francisco", 65, 312),
];

export const ThreeRuns: Story = {
  args: { runs },
};

export const SingleRun: Story = {
  args: { runs: [runs[2]] },
};

export const WhileExecuting: Story = {
  args: { runs, isExecuting: true },
};

// Ticks the two San Francisco runs and opens the comparison, so the diff shows
// the changed temperature. The modal portals to the body, outside the canvas.
export const ComparingTwoRuns: Story = {
  args: { runs },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Compare Run #2" }),
    );
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Compare Run #1" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Compare" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText("Run #1 → Run #2")).toBeInTheDocument();
  },
};
