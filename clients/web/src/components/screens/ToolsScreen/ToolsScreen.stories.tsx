import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { ToolsScreen } from "./ToolsScreen";
import type { ToolCallState } from "./ToolsScreen";

const meta: Meta<typeof ToolsScreen> = {
  title: "Screens/ToolsScreen",
  component: ToolsScreen,
  parameters: { layout: "fullscreen" },
  args: {
    listChanged: false,
    onRefreshList: fn(),
    onSelectTool: fn(),
    onCallTool: fn(),
    onCancelCall: fn(),
    onClearResult: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ToolsScreen>;

const sampleTools: Tool[] = [
  {
    name: "send_message",
    title: "Send Message",
    inputSchema: { type: "object" },
  },
  {
    name: "create_record",
    title: "Create Record",
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
  },
  { name: "delete_records", inputSchema: { type: "object" } },
  { name: "list_users", inputSchema: { type: "object" } },
  { name: "batch_process", inputSchema: { type: "object" } },
];

const resultState: ToolCallState = {
  status: "ok",
  result: {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            id: 42,
            title: "New Record",
            count: 5,
            enabled: true,
            createdAt: "2026-03-17T12:00:00Z",
          },
          null,
          2,
        ),
      },
    ],
  },
};

export const NoSelection: Story = {
  args: {
    tools: sampleTools,
  },
};

export const ToolSelected: Story = {
  args: {
    tools: sampleTools,
    selectedToolName: "create_record",
  },
};

export const WithResult: Story = {
  args: {
    tools: sampleTools,
    selectedToolName: "create_record",
    callState: resultState,
  },
};

export const LongToolName: Story = {
  args: {
    tools: [
      ...sampleTools,
      {
        name: "organization_internal_database_complex_multi_table_join_query_with_aggregation_and_filtering",
        description:
          "Executes a complex multi-table join query across the organization's internal database with support for aggregation functions, nested filtering, and pagination of large result sets.",
        annotations: {
          readOnlyHint: true,
        },
        inputSchema: {
          type: "object",
          properties: {
            primary_table_name: {
              type: "string",
              description: "The main table to query from",
            },
            join_configuration: {
              type: "string",
              description: "JSON configuration for table joins",
            },
            aggregation_functions: {
              type: "string",
              description:
                "Comma-separated list of aggregation functions to apply",
            },
          },
          required: ["primary_table_name"],
        },
      },
    ],
    selectedToolName:
      "organization_internal_database_complex_multi_table_join_query_with_aggregation_and_filtering",
  },
};

export const WithError: Story = {
  args: {
    tools: sampleTools,
    selectedToolName: "create_record",
    callState: {
      status: "error",
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: 'Error executing tool "create_record": ECONNREFUSED 127.0.0.1:5432 — could not connect to the database server. The server may not be running or may be unreachable at the configured host and port. Please verify that PostgreSQL is started, the connection string is correct, and any firewall rules allow traffic on port 5432. If this is a transient issue, retrying after a short delay may resolve it.',
          },
        ],
      },
    },
  },
};

export const WithListChanged: Story = {
  args: {
    tools: sampleTools,
    listChanged: true,
  },
};
