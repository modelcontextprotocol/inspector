import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { PinToggle } from "./PinToggle";

const meta: Meta<typeof PinToggle> = {
  title: "Elements/PinToggle",
  component: PinToggle,
  args: { onToggle: fn() },
};

export default meta;
type Story = StoryObj<typeof PinToggle>;

export const Unpinned: Story = {
  args: { pinned: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  },
};

export const Pinned: Story = {
  args: { pinned: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
  },
};
