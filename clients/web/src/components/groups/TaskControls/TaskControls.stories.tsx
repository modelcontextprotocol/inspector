import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { TaskControls } from "./TaskControls";

const meta: Meta<typeof TaskControls> = {
  title: "Groups/TaskControls",
  component: TaskControls,
  args: {
    searchText: "",
    onSearchChange: fn(),
    onStatusFilterChange: fn(),
    onRefresh: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof TaskControls>;

export const Default: Story = {};

export const WithSearch: Story = {
  args: {
    searchText: "generate",
  },
};

export const WithFilter: Story = {
  args: {
    statusFilter: "working",
  },
};
