import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type {
  CreateMessageRequestParams,
  ElicitRequestFormParams,
} from "@modelcontextprotocol/sdk/types.js";
import {
  PendingClientRequestModal,
  type PendingClientRequestModalProps,
} from "./PendingClientRequestModal";

const samplingRequest: CreateMessageRequestParams = {
  messages: [
    {
      role: "user",
      content: {
        type: "text",
        text: "Summarize the latest changes in this repository.",
      },
    },
  ],
  maxTokens: 1024,
};

// A long sampling request (many messages + preferences), to exercise the
// pinned-actions layout: the content scrolls, the Reject / Send Response
// buttons stay in view.
const tallSamplingRequest: CreateMessageRequestParams = {
  messages: Array.from({ length: 8 }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: {
      type: "text" as const,
      text: `Message ${i + 1}: a representative turn in the conversation the server wants the model to continue from.`,
    },
  })),
  modelPreferences: {
    hints: [{ name: "claude-3-5-sonnet" }],
    costPriority: 0.3,
    speedPriority: 0.6,
    intelligencePriority: 0.9,
  },
  maxTokens: 2048,
  temperature: 0.7,
  includeContext: "thisServer",
};

const formRequest: ElicitRequestFormParams = {
  message: "Please provide your database connection details.",
  requestedSchema: {
    type: "object",
    properties: {
      host: { type: "string", title: "Host" },
      port: { type: "string", title: "Port" },
    },
  },
};

// More fields than fit the modal, to exercise the pinned-actions layout:
// only the fields scroll; the message, warning, and buttons stay in view.
const tallFormRequest: ElicitRequestFormParams = {
  message: "Please provide the full database configuration.",
  requestedSchema: {
    type: "object",
    properties: Object.fromEntries(
      [
        "host",
        "port",
        "database",
        "username",
        "password",
        "schema",
        "poolSize",
        "connectTimeout",
        "idleTimeout",
        "applicationName",
        "sslMode",
        "sslCert",
        "sslKey",
        "sslRootCert",
      ].map((name) => [name, { type: "string", title: name }]),
    ),
  },
};

function InteractiveRender(args: PendingClientRequestModalProps) {
  return (
    <AppShell>
      <AppShell.Main>
        <PendingClientRequestModal {...args} />
      </AppShell.Main>
    </AppShell>
  );
}

const meta: Meta<typeof PendingClientRequestModal> = {
  title: "Groups/PendingClientRequestModal",
  component: PendingClientRequestModal,
  parameters: { layout: "fullscreen" },
  render: InteractiveRender,
  args: {
    serverName: "Everything Server",
    queuePosition: "1 of 1",
    onSamplingRespond: fn(),
    onSamplingReject: fn(),
    onElicitationRespond: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof PendingClientRequestModal>;

export const Sampling: Story = {
  args: {
    request: { kind: "sampling", id: "sampling-1", request: samplingRequest },
  },
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    await body.findByText("Sampling Request");
    expect(
      body.getByText("The server is requesting an LLM completion."),
    ).toBeInTheDocument();
    await userEvent.click(body.getByRole("button", { name: "Send Response" }));
    expect(args.onSamplingRespond).toHaveBeenCalled();
  },
};

export const SamplingTall: Story = {
  args: {
    request: {
      kind: "sampling",
      id: "sampling-tall",
      request: tallSamplingRequest,
    },
  },
};

export const ElicitationForm: Story = {
  args: {
    request: {
      kind: "elicitation-form",
      id: "elicitation-1",
      request: formRequest,
    },
  },
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    await body.findByText("Elicitation Request");
    expect(
      body.getByText(/Please provide your database connection details/),
    ).toBeInTheDocument();
    await userEvent.click(body.getByRole("button", { name: "Submit" }));
    expect(args.onElicitationRespond).toHaveBeenCalledWith({
      action: "accept",
      content: {},
    });
  },
};

export const ElicitationFormTall: Story = {
  args: {
    request: {
      kind: "elicitation-form",
      id: "elicitation-tall",
      request: tallFormRequest,
    },
  },
};

export const ElicitationUrl: Story = {
  args: {
    request: {
      kind: "elicitation-url",
      id: "elicitation-2",
      message: "Authorize access in your browser to continue.",
      url: "https://example.com/authorize?token=abc123",
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await body.findByText("Elicitation Request");
    expect(
      body.getByText("https://example.com/authorize?token=abc123"),
    ).toBeInTheDocument();
  },
};
