import type {
  ClientCapabilities,
  InitializeResult,
} from "@modelcontextprotocol/sdk/types.js";
import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ConnectionInfoModal, type ConnectionInfoModalProps } from "./ConnectionInfoModal";

const initializeResult: InitializeResult = {
  protocolVersion: "2025-06-18",
  serverInfo: { name: "Everything Server", version: "2.1.0" },
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
    logging: {},
    completions: {},
  },
  instructions:
    "This server provides access to the project management system. Use the list_projects tool first to discover available projects before querying tasks.",
};

const clientCapabilities: ClientCapabilities = {
  elicitation: { form: {}, url: {} },
  tasks: {
    list: {},
    cancel: {},
    requests: {
      sampling: { createMessage: {} },
      elicitation: { create: {} },
    },
  },
};

function InteractiveRender(args: ConnectionInfoModalProps) {
  return (
    <AppShell>
      <AppShell.Main>
        <ConnectionInfoModal {...args} />
      </AppShell.Main>
    </AppShell>
  );
}

const meta: Meta<typeof ConnectionInfoModal> = {
  title: "Groups/ConnectionInfoModal",
  component: ConnectionInfoModal,
  parameters: { layout: "fullscreen" },
  render: InteractiveRender,
  args: {
    opened: true,
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ConnectionInfoModal>;

export const StdioConnected: Story = {
  args: {
    initializeResult,
    clientCapabilities,
    transport: "stdio",
  },
};

export const WithOAuth: Story = {
  args: {
    initializeResult: {
      ...initializeResult,
      serverInfo: { name: "Authenticated Server", version: "3.0.0" },
    },
    clientCapabilities,
    transport: "streamable-http",
    oauth: {
      authUrl: "https://auth.example.com/oauth2/authorize",
      scopes: ["read", "write"],
      accessToken: "eyJhbGciOiJSUzI1NiIs...truncated",
    },
  },
};

export const MinimalCapabilities: Story = {
  args: {
    initializeResult: {
      protocolVersion: "2025-03-26",
      serverInfo: { name: "Simple Server", version: "1.0.0" },
      capabilities: { tools: { listChanged: false } },
    },
    clientCapabilities: {},
    transport: "stdio",
  },
};

export const Closed: Story = {
  args: {
    opened: false,
    initializeResult,
    clientCapabilities,
    transport: "stdio",
  },
};
