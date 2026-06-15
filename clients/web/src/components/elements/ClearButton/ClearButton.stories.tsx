import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ClearButton } from "./ClearButton";

const meta: Meta<typeof ClearButton> = {
  title: "Elements/ClearButton",
  component: ClearButton,
};

export default meta;
type Story = StoryObj<typeof ClearButton>;

// Default: labelled "Clear", out of the tab order, but still mouse-clickable.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = await canvas.findByRole("button", { name: "Clear" });
    await expect(button).toHaveAttribute("tabindex", "-1");
    await userEvent.click(button);
  },
};
