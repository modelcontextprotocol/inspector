import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { PinColumnButton } from "./PinColumnButton";

const meta: Meta<typeof PinColumnButton> = {
  title: "Elements/PinColumnButton",
  component: PinColumnButton,
  args: { onPin: fn() },
};

export default meta;
type Story = StoryObj<typeof PinColumnButton>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(
      canvas.getByRole("button", { name: "Pin as column" }),
    ).toBeInTheDocument();
  },
};
