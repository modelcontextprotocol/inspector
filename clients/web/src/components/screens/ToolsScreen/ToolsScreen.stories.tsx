import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ElicitRequest, Tool } from "@modelcontextprotocol/sdk/types.js";
import { Modal } from "@mantine/core";
import { fn, userEvent, within } from "storybook/test";
import { ToolsScreen } from "./ToolsScreen";
import type { ToolCallState } from "./ToolsScreen";
import { SamplingRequestPanel } from "../../groups/SamplingRequestPanel/SamplingRequestPanel";
import { ElicitationFormPanel } from "../../groups/ElicitationFormPanel/ElicitationFormPanel";
import { PendingClientRequests } from "../../groups/PendingClientRequests/PendingClientRequests";
import { InlineSamplingRequest } from "../../groups/InlineSamplingRequest/InlineSamplingRequest";
import { InlineElicitationRequest } from "../../groups/InlineElicitationRequest/InlineElicitationRequest";

const meta: Meta<typeof ToolsScreen> = {
  title: "Screens/ToolsScreen",
  component: ToolsScreen,
  parameters: { layout: "fullscreen" },
  args: {
    listChanged: false,
    onRefreshList: fn(),
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

async function selectToolByLabel(canvasElement: HTMLElement, label: string) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByText(label));
}

export const NoSelection: Story = {
  args: {
    tools: sampleTools,
  },
};

export const ToolSelected: Story = {
  args: {
    tools: sampleTools,
  },
  play: async ({ canvasElement }) => {
    await selectToolByLabel(canvasElement, "Create Record");
  },
};

export const WithResult: Story = {
  args: {
    tools: sampleTools,
    callState: resultState,
  },
  play: async ({ canvasElement }) => {
    await selectToolByLabel(canvasElement, "Create Record");
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
  },
  play: async ({ canvasElement }) => {
    await selectToolByLabel(
      canvasElement,
      "organization_internal_database_complex_multi_table_join_query_with_aggregation_and_filtering",
    );
  },
};

export const WithError: Story = {
  args: {
    tools: sampleTools,
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
  play: async ({ canvasElement }) => {
    await selectToolByLabel(canvasElement, "Create Record");
  },
};

export const WithListChanged: Story = {
  args: {
    tools: sampleTools,
    listChanged: true,
  },
};

const elicitFormRequest = {
  message: "Please provide the database credentials for this operation.",
  requestedSchema: {
    type: "object" as const,
    properties: {
      host: { type: "string" as const, title: "Host" },
      port: { type: "string" as const, title: "Port" },
      password: { type: "string" as const, title: "Password" },
    },
  },
} satisfies ElicitRequest["params"];

export const WithSamplingModal: Story = {
  args: {
    tools: sampleTools,
    callState: { status: "pending" },
  },
  play: async ({ canvasElement }) => {
    await selectToolByLabel(canvasElement, "Create Record");
  },
  render: (args) => (
    <>
      <ToolsScreen {...args} />
      <Modal opened={true} onClose={fn()} title="Sampling Request" size="lg">
        <SamplingRequestPanel
          request={{
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: "Based on the record parameters, generate a summary description for this new record.",
                },
              },
            ],
            maxTokens: 1024,
            modelPreferences: {
              hints: [{ name: "claude-sonnet-4-20250514" }],
            },
          }}
          draftResult={{
            role: "assistant",
            content: { type: "text", text: "" },
            model: "claude-sonnet-4-20250514",
          }}
          onResultChange={fn()}
          onAutoRespond={fn()}
          onSend={fn()}
          onReject={fn()}
        />
      </Modal>
    </>
  ),
};

export const WithElicitationModal: Story = {
  args: {
    tools: sampleTools,
    callState: { status: "pending" },
  },
  play: async ({ canvasElement }) => {
    await selectToolByLabel(canvasElement, "Create Record");
  },
  render: (args) => (
    <>
      <ToolsScreen {...args} />
      <Modal opened={true} onClose={fn()} title="Elicitation Request" size="lg">
        <ElicitationFormPanel
          request={elicitFormRequest}
          serverName="postgres-server"
          values={{}}
          onChange={fn()}
          onSubmit={fn()}
          onCancel={fn()}
        />
      </Modal>
    </>
  ),
};

export const WithPendingRequests: Story = {
  args: {
    tools: sampleTools,
    callState: { status: "pending" },
  },
  play: async ({ canvasElement }) => {
    await selectToolByLabel(canvasElement, "Create Record");
  },
  render: (args) => (
    <>
      <ToolsScreen {...args} />
      <Modal
        opened={true}
        onClose={fn()}
        title="Pending Client Requests"
        size="lg"
      >
        <PendingClientRequests count={2}>
          <InlineSamplingRequest
            request={{
              messages: [
                {
                  role: "user",
                  content: {
                    type: "text",
                    text: "Generate a summary description for a new database record.",
                  },
                },
              ],
              maxTokens: 1024,
            }}
            queuePosition="1 of 2"
            responseText=""
            onAutoRespond={fn()}
            onEditAndSend={fn()}
            onReject={fn()}
            onViewDetails={fn()}
          />
          <InlineElicitationRequest
            request={elicitFormRequest}
            queuePosition="2 of 2"
            values={{}}
            onChange={fn()}
            onSubmit={fn()}
            onCancel={fn()}
          />
        </PendingClientRequests>
      </Modal>
    </>
  ),
};
