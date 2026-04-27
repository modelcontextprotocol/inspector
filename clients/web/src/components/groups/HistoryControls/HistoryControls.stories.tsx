import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { HistoryControls } from "./HistoryControls";

const SAMPLE_METHODS = [
  "tools/call",
  "tools/list",
  "resources/read",
  "resources/list",
  "prompts/get",
  "prompts/list",
  "sampling/createMessage",
  "elicitation/create",
] as const;

const meta: Meta<typeof HistoryControls> = {
  title: "Groups/HistoryControls",
  component: HistoryControls,
  args: {
    searchText: "",
    availableMethods: [...SAMPLE_METHODS],
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
