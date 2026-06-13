import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { FilterToggleButton } from "./FilterToggleButton";

const meta: Meta<typeof FilterToggleButton> = {
  title: "Elements/FilterToggleButton",
  component: FilterToggleButton,
  args: {
    label: "debug",
    color: "blue",
    onToggle: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof FilterToggleButton>;

// Active (on): filled background, aria-pressed=true.
export const Active: Story = {
  args: {
    active: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "debug" }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

// Inactive (off): no fill; hover shows a thin border (visual only).
export const Inactive: Story = {
  args: {
    active: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "debug" }),
    ).toHaveAttribute("aria-pressed", "false");
  },
};

// Clicking an active button invokes onToggle(false).
export const TogglesOff: Story = {
  args: {
    active: true,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "debug" }));
    await expect(args.onToggle).toHaveBeenCalledWith(false);
  },
};
