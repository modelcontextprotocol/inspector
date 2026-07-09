import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { ReplayButton } from "./ReplayButton";

const meta: Meta<typeof ReplayButton> = {
  title: "Elements/ReplayButton",
  component: ReplayButton,
  args: { onReplay: fn() },
};

export default meta;
type Story = StoryObj<typeof ReplayButton>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole("button", { name: "Replay" })).toBeInTheDocument();
  },
};
