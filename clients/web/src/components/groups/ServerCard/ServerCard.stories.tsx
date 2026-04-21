import type {
  ConnectionState,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ServerCard } from "./ServerCard";

const stdioConfig: MCPServerConfig = {
  command: "npx -y @modelcontextprotocol/server-everything",
};

const httpConfig: MCPServerConfig = {
  type: "streamable-http",
  url: "https://api.example.com/mcp",
};

const connected: ConnectionState = { status: "connected" };
const disconnected: ConnectionState = { status: "disconnected" };
const connecting: ConnectionState = { status: "connecting" };
const failed: ConnectionState = {
  status: "error",
  retryCount: 3,
  error: {
    message: "Connection refused",
    details:
      "ECONNREFUSED 127.0.0.1:3000 - The server process exited unexpectedly.",
  },
};

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
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: connected,
    connectionMode: "Subprocess",
    canTestClientFeatures: false,
  },
};

export const Disconnected: Story = {
  args: {
    name: "My MCP Server",
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: disconnected,
    connectionMode: "Subprocess",
    canTestClientFeatures: false,
  },
};

export const Connecting: Story = {
  args: {
    name: "My MCP Server",
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: connecting,
    connectionMode: "Subprocess",
    canTestClientFeatures: false,
  },
};

export const Failed: Story = {
  args: {
    name: "My MCP Server",
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: failed,
    connectionMode: "Subprocess",
    canTestClientFeatures: false,
  },
};

export const WithClientFeatures: Story = {
  args: {
    name: "My MCP Server",
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: connected,
    connectionMode: "Subprocess",
    canTestClientFeatures: true,
  },
};

export const LongServerName: Story = {
  args: {
    name: "my-organization-super-long-experimental-mcp-server-with-many-features-v2",
    config: {
      command:
        "npx -y @my-organization/super-long-experimental-mcp-server-with-many-features-v2",
    },
    info: {
      name: "my-organization-super-long-experimental-mcp-server-with-many-features-v2",
      version: "1.0.0-beta.42",
    },
    connection: connected,
    connectionMode: "Subprocess",
    canTestClientFeatures: true,
  },
};

export const HttpDirect: Story = {
  args: {
    name: "Remote API Server",
    config: httpConfig,
    info: { name: "Remote API Server", version: "2.0.0" },
    connection: connected,
    connectionMode: "Direct",
    canTestClientFeatures: false,
  },
};

export const CompactConnected: Story = {
  args: {
    name: "My MCP Server",
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: connected,
    connectionMode: "Subprocess",
    canTestClientFeatures: false,
    compact: true,
  },
};

export const CompactDisconnected: Story = {
  args: {
    name: "My MCP Server",
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: disconnected,
    connectionMode: "Subprocess",
    canTestClientFeatures: false,
    compact: true,
  },
};
