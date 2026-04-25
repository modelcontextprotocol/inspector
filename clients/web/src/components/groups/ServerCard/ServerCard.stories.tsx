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
    onServerInfo: fn(),
    onSettings: fn(),
    onEdit: fn(),
    onClone: fn(),
    onRemove: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ServerCard>;

export const Connected: Story = {
  args: {
    id: "7f3b2a8e-1c4d-4e5f-9a0b-3c2d1e4f5a6b",
    name: "My MCP Server",
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: connected,
  },
};

export const Disconnected: Story = {
  args: {
    id: "7f3b2a8e-1c4d-4e5f-9a0b-3c2d1e4f5a6b",
    name: "My MCP Server",
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: disconnected,
  },
};

export const Connecting: Story = {
  args: {
    id: "7f3b2a8e-1c4d-4e5f-9a0b-3c2d1e4f5a6b",
    name: "My MCP Server",
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: connecting,
  },
};

export const Failed: Story = {
  args: {
    id: "7f3b2a8e-1c4d-4e5f-9a0b-3c2d1e4f5a6b",
    name: "My MCP Server",
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: failed,
  },
};

export const LongServerName: Story = {
  args: {
    id: "a1b2c3d4-e5f6-4789-9abc-def012345678",
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
  },
};

export const HttpDirect: Story = {
  args: {
    id: "9e8d7c6b-5a4f-4321-bdc6-fedcba098765",
    name: "Remote API Server",
    config: httpConfig,
    info: { name: "Remote API Server", version: "2.0.0" },
    connection: connected,
  },
};

export const CompactConnected: Story = {
  args: {
    id: "7f3b2a8e-1c4d-4e5f-9a0b-3c2d1e4f5a6b",
    name: "My MCP Server",
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: connected,
    compact: true,
  },
};

export const CompactDisconnected: Story = {
  args: {
    id: "7f3b2a8e-1c4d-4e5f-9a0b-3c2d1e4f5a6b",
    name: "My MCP Server",
    config: stdioConfig,
    info: { name: "My MCP Server", version: "1.2.0" },
    connection: disconnected,
    compact: true,
  },
};
