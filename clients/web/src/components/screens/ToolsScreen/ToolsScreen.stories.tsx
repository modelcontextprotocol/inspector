import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ToolsScreen } from "./ToolsScreen";
import type { ToolListItemProps } from "../../groups/ToolListItem/ToolListItem";
import type { ToolDetailPanelProps } from "../../groups/ToolDetailPanel/ToolDetailPanel";
import type { ResultPanelProps } from "../../groups/ResultPanel/ResultPanel";

const meta: Meta<typeof ToolsScreen> = {
  title: "Screens/ToolsScreen",
  component: ToolsScreen,
  parameters: { layout: "fullscreen" },
  args: {
    searchText: "",
    listChanged: false,
    onSearchChange: fn(),
    onRefreshList: fn(),
    onSelectTool: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ToolsScreen>;

const sampleTools: ToolListItemProps[] = [
  {
    name: "send_message",
    title: "Send Message",
    selected: false,
    onClick: fn(),
  },
  {
    name: "create_record",
    title: "Create Record",
    selected: false,
    onClick: fn(),
  },
  {
    name: "delete_records",
    selected: false,
    onClick: fn(),
  },
  { name: "list_users", selected: false, onClick: fn() },
  {
    name: "batch_process",
    selected: false,
    onClick: fn(),
  },
];

const selectedToolData: ToolDetailPanelProps = {
  name: "create_record",
  title: "Create Record",
  description: "Creates a new record with the given parameters",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Record title" },
      count: { type: "number", description: "Number of items" },
      enabled: { type: "boolean", description: "Whether the record is active" },
    },
    required: ["title"],
  },
  formValues: {},
  isExecuting: false,
  onFormChange: fn(),
  onExecute: fn(),
  onCancel: fn(),
};

const resultData: ResultPanelProps = {
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
  onClear: fn(),
};

function toolsWithSelected(selectedName: string): ToolListItemProps[] {
  return sampleTools.map((tool) => ({
    ...tool,
    selected: tool.name === selectedName,
  }));
}

export const NoSelection: Story = {
  args: {
    tools: sampleTools,
  },
};

export const ToolSelected: Story = {
  args: {
    tools: toolsWithSelected("create_record"),
    selectedTool: selectedToolData,
  },
};

export const WithResult: Story = {
  args: {
    tools: toolsWithSelected("create_record"),
    selectedTool: selectedToolData,
    result: resultData,
  },
};

export const LongToolName: Story = {
  args: {
    tools: [
      ...sampleTools,
      {
        name: "organization_internal_database_complex_multi_table_join_query_with_aggregation_and_filtering",
        selected: true,
        onClick: fn(),
      },
    ],
    selectedTool: {
      name: "organization_internal_database_complex_multi_table_join_query_with_aggregation_and_filtering",
      annotations: {
        readOnly: true,
        longRunning: true,
      },
      description:
        "Executes a complex multi-table join query across the organization's internal database with support for aggregation functions, nested filtering, and pagination of large result sets.",
      schema: {
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
      formValues: {},
      isExecuting: false,
      onFormChange: fn(),
      onExecute: fn(),
      onCancel: fn(),
    },
  },
};

export const WithListChanged: Story = {
  args: {
    tools: sampleTools,
    listChanged: true,
  },
};
