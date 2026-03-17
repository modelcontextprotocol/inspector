import type { Meta, StoryObj } from "@storybook/react-vite";
import { CapabilityItem } from "./CapabilityItem";

const meta: Meta<typeof CapabilityItem> = {
  title: "Atoms/CapabilityItem",
  component: CapabilityItem,
};

export default meta;
type Story = StoryObj<typeof CapabilityItem>;

export const Supported: Story = {
  args: {
    name: "Tools",
    supported: true,
  },
};

export const SupportedWithCount: Story = {
  args: {
    name: "Tools",
    supported: true,
    count: 4,
  },
};

export const NotSupported: Story = {
  args: {
    name: "Completions",
    supported: false,
  },
};
