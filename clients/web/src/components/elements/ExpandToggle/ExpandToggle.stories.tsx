import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { ExpandToggle } from "./ExpandToggle";

const meta: Meta<typeof ExpandToggle> = {
  title: "Elements/ExpandToggle",
  component: ExpandToggle,
  args: { onToggle: fn() },
};

export default meta;
type Story = StoryObj<typeof ExpandToggle>;

export const Collapsed: Story = {
  args: { expanded: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("button", { name: "Expand" })).toBeInTheDocument();
  },
};

export const Expanded: Story = {
  args: { expanded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  },
};
