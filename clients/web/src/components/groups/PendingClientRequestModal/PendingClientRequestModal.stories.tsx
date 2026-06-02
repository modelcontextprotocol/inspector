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
    await userEvent.click(body.getByRole("button", { name: "Auto-respond" }));
    expect(args.onSamplingRespond).toHaveBeenCalled();
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
