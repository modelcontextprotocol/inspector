import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { MessageMethod } from "@inspector/core/mcp/types.js";
import { ProtocolControls } from "./ProtocolControls";

const SAMPLE_METHODS: MessageMethod[] = [
  "tools/call",
  "tools/list",
  "resources/read",
  "resources/list",
  "prompts/get",
  "prompts/list",
  "sampling/createMessage",
  "elicitation/create",
];

const meta: Meta<typeof ProtocolControls> = {
  title: "Groups/ProtocolControls",
  component: ProtocolControls,
  args: {
    searchText: "",
    availableMethods: SAMPLE_METHODS,
    visibleDirections: { client: true, server: true },
    onSearchChange: fn(),
    onMethodFilterChange: fn(),
    onToggleDirection: fn(),
    onToggleAllDirections: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ProtocolControls>;

export const Default: Story = {};

export const WithFilters: Story = {
  args: {
    searchText: "tools",
    methodFilter: "tools/call",
  },
};
