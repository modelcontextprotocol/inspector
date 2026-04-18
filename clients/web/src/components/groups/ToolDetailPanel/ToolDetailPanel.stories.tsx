import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { ToolDetailPanel } from "./ToolDetailPanel";

const meta: Meta<typeof ToolDetailPanel> = {
  title: "Groups/ToolDetailPanel",
  component: ToolDetailPanel,
  args: {
    onFormChange: fn(),
    onExecute: fn(),
    onCancel: fn(),
    formValues: {},
    isExecuting: false,
  },
};

export default meta;
type Story = StoryObj<typeof ToolDetailPanel>;

const sendMessageTool: Tool = {
  name: "send_message",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "The message to send" },
    },
    required: ["message"],
  },
};

const createRecordTool: Tool = {
  name: "create_record",
  description: "Creates a new record with the given parameters",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Record title" },
      count: { type: "number", description: "Number of items" },
      enabled: {
        type: "boolean",
        description: "Whether the record is active",
      },
    },
    required: ["title"],
  },
};

const deleteRecordsTool: Tool = {
  name: "delete_records",
  description: "Deletes records matching the given criteria",
  annotations: {
    readOnlyHint: true,
    destructiveHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Pattern to match records" },
    },
  },
};

const longQueryTool: Tool = {
  name: "long_query",
  description: "Runs a long database query",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "SQL query to execute" },
    },
  },
};

const batchProcessTool: Tool = {
  name: "batch_process",
  description: "Processes items in batch",
  inputSchema: {
    type: "object",
    properties: {
      batchSize: { type: "number", description: "Number of items per batch" },
    },
  },
};

export const SimpleStringParam: Story = {
  args: {
    tool: sendMessageTool,
  },
};

export const MultipleParams: Story = {
  args: {
    tool: createRecordTool,
  },
};

export const WithAnnotations: Story = {
  args: {
    tool: deleteRecordsTool,
  },
};

export const Executing: Story = {
  args: {
    tool: longQueryTool,
    isExecuting: true,
    formValues: { query: "SELECT * FROM users" },
  },
};

export const WithProgress: Story = {
  args: {
    tool: batchProcessTool,
    isExecuting: true,
    progress: { progress: 3, total: 5, message: "Processing step 3 of 5" },
    formValues: { batchSize: 100 },
  },
};
