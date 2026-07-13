import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MethodBadge } from "./MethodBadge";

const meta: Meta<typeof MethodBadge> = {
  title: "Elements/MethodBadge",
  component: MethodBadge,
};

export default meta;
type Story = StoryObj<typeof MethodBadge>;

export const ToolsList: Story = {
  args: { method: "tools/list" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("tools/list")).toBeInTheDocument();
  },
};

export const TasksList: Story = {
  args: { method: "tasks/list" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("tasks/list")).toBeInTheDocument();
  },
};
