import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ServerListScreen, type ServerEntry } from "./ServerListScreen";

const meta: Meta<typeof ServerListScreen> = {
  title: "Screens/ServerListScreen",
  component: ServerListScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onAddManually: fn(),
    onImportConfig: fn(),
    onImportServerJson: fn(),
    onToggleConnection: fn(),
    onServerInfo: fn(),
    onSettings: fn(),
    onEdit: fn(),
    onClone: fn(),
    onRemove: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ServerListScreen>;

const connectedStdioServer: ServerEntry = {
  id: "5e8c3d1f-2a4b-4c6d-8e7f-1a2b3c4d5e6f",
  name: "Local Dev Server",
  config: {
    command: "npx @modelcontextprotocol/server-filesystem /home/user/projects",
  },
  info: { name: "Local Dev Server", version: "1.2.0" },
  connection: { status: "connected" },
};

const disconnectedStdioServer: ServerEntry = {
  id: "b3a7c1d2-9f8e-4a5b-bc6d-7e8f9a0b1c2d",
  name: "Database Tools",
  config: {
    command: "python -m mcp_server_sqlite --db-path ./data.db",
  },
  info: { name: "Database Tools", version: "0.9.1" },
  connection: { status: "disconnected" },
};

const failedHttpServer: ServerEntry = {
  id: "c4d5e6f7-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
  name: "Remote API Server",
  config: {
    type: "streamable-http",
    url: "https://api.example.com/mcp",
  },
  info: { name: "Remote API Server", version: "2.0.0" },
  connection: {
    status: "error",
    retryCount: 3,
    error: {
      message: "Connection refused",
      details: "ECONNREFUSED 127.0.0.1:8080 - The server may not be running.",
    },
  },
};

const connectingHttpServer: ServerEntry = {
  id: "d6e7f8a9-0b1c-4d2e-bf3a-4b5c6d7e8f90",
  name: "Staging Server",
  config: {
    type: "streamable-http",
    url: "https://staging.example.com/mcp",
  },
  connection: { status: "connecting" },
};

export const MultipleServers: Story = {
  args: {
    servers: [connectedStdioServer, disconnectedStdioServer, failedHttpServer],
  },
};

export const SingleServer: Story = {
  args: {
    servers: [connectedStdioServer],
  },
};

export const Empty: Story = {
  args: {
    servers: [],
  },
};

export const MixedStates: Story = {
  args: {
    servers: [
      connectedStdioServer,
      disconnectedStdioServer,
      failedHttpServer,
      connectingHttpServer,
    ],
  },
};

export const WithActiveServer: Story = {
  args: {
    servers: [connectedStdioServer, disconnectedStdioServer, failedHttpServer],
    activeServer: connectedStdioServer.id,
  },
};
