import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ServerListScreen } from "./ServerListScreen";
import type { ServerCardProps } from "../../groups/ServerCard/ServerCard";

const meta: Meta<typeof ServerListScreen> = {
  title: "Screens/ServerListScreen",
  component: ServerListScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onAddManually: fn(),
    onImportConfig: fn(),
    onImportServerJson: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ServerListScreen>;

function makeServerCallbacks(): Pick<
  ServerCardProps,
  | "onToggleConnection"
  | "onServerInfo"
  | "onSettings"
  | "onEdit"
  | "onClone"
  | "onRemove"
  | "onTestSampling"
  | "onTestElicitationForm"
  | "onTestElicitationUrl"
  | "onConfigureRoots"
> {
  return {
    onToggleConnection: fn(),
    onServerInfo: fn(),
    onSettings: fn(),
    onEdit: fn(),
    onClone: fn(),
    onRemove: fn(),
    onTestSampling: fn(),
    onTestElicitationForm: fn(),
    onTestElicitationUrl: fn(),
    onConfigureRoots: fn(),
  };
}

const connectedStdioServer: ServerCardProps = {
  name: "Local Dev Server",
  config: {
    command: "npx @modelcontextprotocol/server-filesystem /home/user/projects",
  },
  info: { name: "Local Dev Server", version: "1.2.0" },
  connection: { status: "connected" },
  connectionMode: "Direct",
  canTestClientFeatures: true,
  ...makeServerCallbacks(),
};

const disconnectedStdioServer: ServerCardProps = {
  name: "Database Tools",
  config: {
    command: "python -m mcp_server_sqlite --db-path ./data.db",
  },
  info: { name: "Database Tools", version: "0.9.1" },
  connection: { status: "disconnected" },
  connectionMode: "Direct",
  canTestClientFeatures: false,
  ...makeServerCallbacks(),
};

const failedHttpServer: ServerCardProps = {
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
  connectionMode: "Streamable HTTP",
  canTestClientFeatures: false,
  ...makeServerCallbacks(),
};

const connectingHttpServer: ServerCardProps = {
  name: "Staging Server",
  config: {
    type: "streamable-http",
    url: "https://staging.example.com/mcp",
  },
  connection: { status: "connecting" },
  connectionMode: "Streamable HTTP",
  canTestClientFeatures: false,
  ...makeServerCallbacks(),
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
