import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { ToolControls } from "./ToolControls";

const meta: Meta<typeof ToolControls> = {
  title: "Groups/ToolControls",
  component: ToolControls,
  args: {
    onRefreshList: fn(),
    onSelectTool: fn(),
    listChanged: false,
  },
};

export default meta;
type Story = StoryObj<typeof ToolControls>;

const sampleTools: Tool[] = [
  {
    name: "send_message",
    title: "Send Message",
    inputSchema: { type: "object" },
  },
  {
    name: "create_record",
    title: "Create Record",
    inputSchema: { type: "object" },
  },
  { name: "delete_records", inputSchema: { type: "object" } },
  { name: "list_users", inputSchema: { type: "object" } },
  { name: "batch_process", inputSchema: { type: "object" } },
];

export const Default: Story = {
  args: {
    tools: sampleTools,
  },
};

export const WithSelection: Story = {
  args: {
    tools: sampleTools,
    selectedName: "create_record",
  },
};

export const WithSearch: Story = {
  args: {
    tools: sampleTools,
  },
};

export const ListChanged: Story = {
  args: {
    tools: sampleTools,
    listChanged: true,
  },
};

export const Empty: Story = {
  args: {
    tools: [],
  },
};
