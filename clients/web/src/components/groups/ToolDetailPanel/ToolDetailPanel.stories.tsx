import type { Meta, StoryObj } from "@storybook/react-vite";
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

export const SimpleStringParam: Story = {
  args: {
    name: "send_message",
    schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The message to send" },
      },
      required: ["message"],
    },
  },
};

export const MultipleParams: Story = {
  args: {
    name: "create_record",
    description: "Creates a new record with the given parameters",
    schema: {
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
  },
};

export const WithAnnotations: Story = {
  args: {
    name: "delete_records",
    description: "Deletes records matching the given criteria",
    annotations: {
      audience: "admin",
      readOnly: true,
      destructive: true,
    },
    schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Pattern to match records" },
      },
    },
  },
};

export const Executing: Story = {
  args: {
    name: "long_query",
    description: "Runs a long database query",
    isExecuting: true,
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "SQL query to execute" },
      },
    },
    formValues: { query: "SELECT * FROM users" },
  },
};

export const WithProgress: Story = {
  args: {
    name: "batch_process",
    description: "Processes items in batch",
    isExecuting: true,
    progress: { percent: 60, description: "Processing step 3 of 5" },
    schema: {
      type: "object",
      properties: {
        batchSize: { type: "number", description: "Number of items per batch" },
      },
    },
    formValues: { batchSize: 100 },
  },
};
