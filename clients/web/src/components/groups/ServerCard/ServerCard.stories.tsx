import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ServerCard } from "./ServerCard";

const meta: Meta<typeof ServerCard> = {
  title: "Groups/ServerCard",
  component: ServerCard,
  args: {
    onToggleConnection: fn(),
    onSetActiveServer: fn(),
    onServerInfo: fn(),
    onSettings: fn(),
    onEdit: fn(),
    onClone: fn(),
    onRemove: fn(),
    onTestSampling: fn(),
    onTestElicitationForm: fn(),
    onTestElicitationUrl: fn(),
    onConfigureRoots: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ServerCard>;

export const Connected: Story = {
  args: {
    name: "My MCP Server",
    version: "1.2.0",
    transport: "stdio",
    connectionMode: "Subprocess",
    command: "npx -y @modelcontextprotocol/server-everything",
    status: "connected",
    canTestClientFeatures: false,
  },
};

export const Disconnected: Story = {
  args: {
    name: "My MCP Server",
    version: "1.2.0",
    transport: "stdio",
    connectionMode: "Subprocess",
    command: "npx -y @modelcontextprotocol/server-everything",
    status: "disconnected",
    canTestClientFeatures: false,
  },
};

export const Connecting: Story = {
  args: {
    name: "My MCP Server",
    version: "1.2.0",
    transport: "stdio",
    connectionMode: "Subprocess",
    command: "npx -y @modelcontextprotocol/server-everything",
    status: "connecting",
    canTestClientFeatures: false,
  },
};

export const Failed: Story = {
  args: {
    name: "My MCP Server",
    version: "1.2.0",
    transport: "stdio",
    connectionMode: "Subprocess",
    command: "npx -y @modelcontextprotocol/server-everything",
    status: "error",
    retryCount: 3,
    error: {
      message: "Connection refused",
      details:
        "ECONNREFUSED 127.0.0.1:3000 - The server process exited unexpectedly.",
    },
    canTestClientFeatures: false,
  },
};

export const WithClientFeatures: Story = {
  args: {
    name: "My MCP Server",
    version: "1.2.0",
    transport: "stdio",
    connectionMode: "Subprocess",
    command: "npx -y @modelcontextprotocol/server-everything",
    status: "connected",
    canTestClientFeatures: true,
  },
};

export const LongServerName: Story = {
  args: {
    name: "my-organization-super-long-experimental-mcp-server-with-many-features-v2",
    version: "1.0.0-beta.42",
    transport: "stdio",
    connectionMode: "Subprocess",
    command:
      "npx -y @my-organization/super-long-experimental-mcp-server-with-many-features-v2",
    status: "connected",
    canTestClientFeatures: true,
  },
};

export const HttpDirect: Story = {
  args: {
    name: "Remote API Server",
    version: "2.0.0",
    transport: "streamable-http",
    connectionMode: "Direct",
    command: "https://api.example.com/mcp",
    status: "connected",
    canTestClientFeatures: false,
  },
};

export const CompactConnected: Story = {
  args: {
    name: "My MCP Server",
    version: "1.2.0",
    transport: "stdio",
    connectionMode: "Subprocess",
    command: "npx -y @modelcontextprotocol/server-everything",
    status: "connected",
    canTestClientFeatures: false,
    compact: true,
  },
};

export const CompactDisconnected: Story = {
  args: {
    name: "My MCP Server",
    version: "1.2.0",
    transport: "stdio",
    connectionMode: "Subprocess",
    command: "npx -y @modelcontextprotocol/server-everything",
    status: "disconnected",
    canTestClientFeatures: false,
    compact: true,
  },
};
