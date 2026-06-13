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
    const button = await canvas.findByRole("button", { name: "debug" });
    await expect(button).toHaveAttribute("aria-pressed", "true");
    // Active renders a filled background (driven by `[aria-pressed="true"]`).
    await expect(getComputedStyle(button).backgroundColor).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
  },
};

const TRANSPARENT = "rgba(0, 0, 0, 0)";

// Inactive (off): no fill, and the reserved border is transparent. The visible
// hover border is intentionally NOT asserted here — the Storybook/vitest runner
// dispatches synthetic pointer events that don't engage real CSS `:hover`. The
// border-on-hover (and that it isn't an inline style outranking the `:hover`
// rule — the #1460 regression) was verified with real Playwright `page.hover`.
export const Inactive: Story = {
  args: {
    active: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = await canvas.findByRole("button", { name: "debug" });
    await expect(button).toHaveAttribute("aria-pressed", "false");

    // The reserved border is transparent by default and there's no active fill,
    // so the inactive button reads as empty until hovered or toggled on.
    await expect(getComputedStyle(button).borderTopColor).toBe(TRANSPARENT);
    await expect(getComputedStyle(button).backgroundColor).toBe(TRANSPARENT);
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
