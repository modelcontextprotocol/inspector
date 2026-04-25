import type {
  ClientCapabilities,
  InitializeResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ServerInfoContent } from "./ServerInfoContent";

const fullResult: InitializeResult = {
  protocolVersion: "2025-03-26",
  serverInfo: { name: "Everything Server", version: "2.1.0" },
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
    logging: {},
    completions: {},
  },
  instructions:
    "This server provides access to the project management system. Use the list_projects tool first to discover available projects before querying tasks. Rate limiting applies: max 60 requests per minute.",
};

const fullClientCaps: ClientCapabilities = {
  roots: { listChanged: true },
  sampling: {},
  elicitation: {},
  experimental: {},
};

const meta: Meta<typeof ServerInfoContent> = {
  title: "Groups/ServerInfoContent",
  component: ServerInfoContent,
};

export default meta;
type Story = StoryObj<typeof ServerInfoContent>;

export const FullCapabilities: Story = {
  args: {
    initializeResult: fullResult,
    clientCapabilities: fullClientCaps,
    transport: "stdio",
  },
};

export const MinimalCapabilities: Story = {
  args: {
    initializeResult: {
      protocolVersion: "2025-03-26",
      serverInfo: { name: "Simple Server", version: "1.0.0" },
      capabilities: {
        tools: { listChanged: false },
      },
    },
    clientCapabilities: {
      roots: { listChanged: true },
    },
    transport: "streamable-http",
  },
};

export const WithInstructions: Story = {
  args: {
    initializeResult: fullResult,
    clientCapabilities: {
      roots: { listChanged: true },
      sampling: {},
    },
    transport: "stdio",
  },
};

export const WithOAuth: Story = {
  args: {
    initializeResult: {
      protocolVersion: "2025-03-26",
      serverInfo: { name: "Authenticated Server", version: "3.0.0" },
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true },
      },
    },
    clientCapabilities: {
      roots: { listChanged: true },
    },
    transport: "streamable-http",
    oauth: {
      authUrl: "https://auth.example.com/oauth2/authorize",
      scopes: ["read", "write", "admin"],
      accessToken: "eyJhbGciOiJSUzI1NiIs...truncated",
    },
  },
};
