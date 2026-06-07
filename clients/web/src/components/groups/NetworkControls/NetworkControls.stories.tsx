import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { NetworkControls } from "./NetworkControls";

const meta: Meta<typeof NetworkControls> = {
  title: "Groups/NetworkControls",
  component: NetworkControls,
  args: {
    filterText: "",
    visibleCategories: { auth: true, transport: true },
    onFilterChange: fn(),
    onToggleCategory: fn(),
    onToggleAllCategories: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof NetworkControls>;

export const AllVisible: Story = {};

export const NoneVisible: Story = {
  args: {
    visibleCategories: { auth: false, transport: false },
  },
};

export const OnlyAuth: Story = {
  args: {
    visibleCategories: { auth: true, transport: false },
  },
};
