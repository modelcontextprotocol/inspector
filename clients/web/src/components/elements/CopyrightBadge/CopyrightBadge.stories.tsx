import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { CopyrightBadge, COPYRIGHT_NOTICE } from "./CopyrightBadge";

const meta: Meta<typeof CopyrightBadge> = {
  title: "Elements/CopyrightBadge",
  component: CopyrightBadge,
};

export default meta;
type Story = StoryObj<typeof CopyrightBadge>;

// The grey copyright notice pinned to the lower-left corner of the viewport.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(COPYRIGHT_NOTICE)).toBeInTheDocument();
  },
};
