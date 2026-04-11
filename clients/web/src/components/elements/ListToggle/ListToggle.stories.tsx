import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ListToggle } from "./ListToggle";

const meta: Meta<typeof ListToggle> = {
  title: "Elements/ListToggle",
  component: ListToggle,
};

export default meta;
type Story = StoryObj<typeof ListToggle>;

export const Expanded: Story = {
  args: {
    compact: false,
    onToggle: fn(),
  },
};

export const Collapsed: Story = {
  args: {
    compact: true,
    onToggle: fn(),
  },
};

export const SubtleExpanded: Story = {
  args: {
    compact: false,
    variant: "subtle",
    onToggle: fn(),
  },
};

export const SubtleCollapsed: Story = {
  args: {
    compact: true,
    variant: "subtle",
    onToggle: fn(),
  },
};
