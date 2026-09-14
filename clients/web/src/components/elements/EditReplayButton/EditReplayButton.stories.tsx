import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { EditReplayButton } from "./EditReplayButton";

const meta: Meta<typeof EditReplayButton> = {
  title: "Elements/EditReplayButton",
  component: EditReplayButton,
  args: { onClick: fn() },
};

export default meta;
type Story = StoryObj<typeof EditReplayButton>;

export const Default: Story = {};

export const Activated: Story = {
  play: async ({ args, canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Edit and replay" }),
    );
    await expect(args.onClick).toHaveBeenCalled();
  },
};
