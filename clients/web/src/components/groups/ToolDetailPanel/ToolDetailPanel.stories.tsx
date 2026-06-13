import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { expect, fn, userEvent, within } from "storybook/test";
import { ToolDetailPanel } from "./ToolDetailPanel";

const meta: Meta<typeof ToolDetailPanel> = {
  title: "Groups/ToolDetailPanel",
  component: ToolDetailPanel,
  args: {
    onFormChange: fn(),
    onExecute: fn(),
    onCancel: fn(),
    onRunAsTaskChange: fn(),
    formValues: {},
    isExecuting: false,
    serverSupportsTaskToolCalls: false,
    runAsTask: false,
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

const ICON_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#228be6"><circle cx="12" cy="12" r="10"/></svg>',
  );

const iconedTool: Tool = {
  name: "send_message",
  title: "Send Message",
  description: "Sends a message to the recipient",
  icons: [{ src: ICON_DATA_URL }],
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "The message to send" },
    },
    required: ["message"],
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

// Mirrors the gnarly `sequential-thinking-server` case from issue #1381: a very
// long description that, when expanded, would otherwise push the form and
// Execute footer off-screen. Collapsed by default keeps the form reachable.
const longDescriptionTool: Tool = {
  name: "sequentialthinking",
  title: "Sequential Thinking",
  description: [
    "A detailed tool for dynamic and reflective problem-solving through thoughts.",
    "This tool helps analyze problems through a flexible thinking process that can",
    "adapt and evolve. Each thought can build on, question, or revise previous",
    "insights as understanding deepens.",
    "",
    "When to use this tool: breaking down complex problems into steps, planning and",
    "design with room for revision, analysis that might need course correction, and",
    "problems where the full scope might not be clear initially.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      thought: { type: "string", description: "Your current thinking step" },
      nextThoughtNeeded: {
        type: "boolean",
        description: "Whether another thought step is needed",
      },
    },
    required: ["thought", "nextThoughtNeeded"],
  },
};

export const SimpleStringParam: Story = {
  args: {
    tool: sendMessageTool,
  },
};

// Long description collapsed by default — only the chevron toggle is shown.
export const LongDescription: Story = {
  args: {
    tool: longDescriptionTool,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "Show description" }),
    ).toBeInTheDocument();
  },
};

// Clicking the chevron expands the description (toggle flips to "Hide").
export const LongDescriptionExpanded: Story = {
  args: {
    tool: longDescriptionTool,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Show description" }),
    );
    await expect(
      await canvas.findByRole("button", { name: "Hide description" }),
    ).toBeInTheDocument();
  },
};

export const MultipleParams: Story = {
  args: {
    tool: createRecordTool,
  },
};

export const WithIcon: Story = {
  args: {
    tool: iconedTool,
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

const optionalTaskTool: Tool = {
  name: "summarize_corpus",
  description: "Summarizes a large corpus — can run as a background task",
  execution: { taskSupport: "optional" },
  inputSchema: {
    type: "object",
    properties: {
      corpus: { type: "string", description: "Text to summarize" },
    },
  },
};

const requiredTaskTool: Tool = {
  name: "train_model",
  description: "Long-running training job — always runs as a task",
  execution: { taskSupport: "required" },
  inputSchema: {
    type: "object",
    properties: {
      dataset: { type: "string", description: "Dataset id" },
    },
  },
};

// Server supports task tool calls + tool is `optional`: the toggle renders
// enabled and off by default.
export const RunAsTaskOptional: Story = {
  args: {
    tool: optionalTaskTool,
    serverSupportsTaskToolCalls: true,
    runAsTask: false,
  },
};

// Tool is `required`: the toggle is forced on and disabled.
export const RunAsTaskRequired: Story = {
  args: {
    tool: requiredTaskTool,
    serverSupportsTaskToolCalls: true,
  },
};
