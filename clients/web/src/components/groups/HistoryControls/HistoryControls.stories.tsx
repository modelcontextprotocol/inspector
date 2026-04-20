import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { HistoryControls } from "./HistoryControls";

const meta: Meta<typeof HistoryControls> = {
  title: "Groups/HistoryControls",
  component: HistoryControls,
  args: {
    searchText: "",
    onSearchChange: fn(),
    onMethodFilterChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof HistoryControls>;

export const Default: Story = {};

export const WithFilters: Story = {
  args: {
    searchText: "tools",
    methodFilter: "tools/call",
  },
};
