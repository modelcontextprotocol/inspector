import type { Meta, StoryObj } from "@storybook/react-vite";
import { EraBadge } from "./EraBadge";

const meta: Meta<typeof EraBadge> = {
  title: "Elements/EraBadge",
  component: EraBadge,
};

export default meta;
type Story = StoryObj<typeof EraBadge>;

export const Modern: Story = {
  args: { era: "modern" },
};

export const Legacy: Story = {
  args: { era: "legacy" },
};

export const NotConnected: Story = {
  args: { era: undefined },
};
