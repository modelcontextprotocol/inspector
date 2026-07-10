import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { VersionBadge } from "./VersionBadge";

const meta: Meta<typeof VersionBadge> = {
  title: "Elements/VersionBadge",
  component: VersionBadge,
  args: { version: "2.0.0" },
};

export default meta;
type Story = StoryObj<typeof VersionBadge>;

// Default: a grey `v2.0.0` pinned to the lower-right corner of the viewport.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const badge = await canvas.findByText("v2.0.0");
    await expect(badge).toBeInTheDocument();
    await expect(badge).toHaveAttribute(
      "aria-label",
      "Inspector version 2.0.0",
    );
  },
};

// No version yet (initial load / legacy backend): renders nothing.
export const Hidden: Story = {
  args: { version: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/^v/)).toBeNull();
  },
};
