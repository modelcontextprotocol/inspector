import type { Meta, StoryObj } from "@storybook/react-vite";
import { CapabilityItem } from "./CapabilityItem";

const meta: Meta<typeof CapabilityItem> = {
  title: "Elements/CapabilityItem",
  component: CapabilityItem,
};

export default meta;
type Story = StoryObj<typeof CapabilityItem>;

export const Supported: Story = {
  args: {
    capability: "tools",
    supported: true,
  },
};

export const SupportedWithCount: Story = {
  args: {
    capability: "tools",
    supported: true,
    count: 4,
  },
};

// Paginated mode with a `nextCursor` still unloaded: the count is a lower bound.
export const SupportedWithPartialCount: Story = {
  args: {
    capability: "tools",
    supported: true,
    count: 10,
    partial: true,
  },
};

export const NotSupported: Story = {
  args: {
    capability: "completions",
    supported: false,
  },
};
