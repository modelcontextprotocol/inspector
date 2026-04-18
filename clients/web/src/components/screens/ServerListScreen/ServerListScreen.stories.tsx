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
  version: "1.2.0",
  transport: "stdio",
  connectionMode: "Direct",
  command: "npx @modelcontextprotocol/server-filesystem /home/user/projects",
  status: "connected",
  canTestClientFeatures: true,
  ...makeServerCallbacks(),
};

const disconnectedStdioServer: ServerCardProps = {
  name: "Database Tools",
  version: "0.9.1",
  transport: "stdio",
  connectionMode: "Direct",
  command: "python -m mcp_server_sqlite --db-path ./data.db",
  status: "disconnected",
  canTestClientFeatures: false,
  ...makeServerCallbacks(),
};

const failedHttpServer: ServerCardProps = {
  name: "Remote API Server",
  version: "2.0.0",
  transport: "streamable-http",
  connectionMode: "Streamable HTTP",
  command: "https://api.example.com/mcp",
  status: "error",
  retryCount: 3,
  error: {
    message: "Connection refused",
    details: "ECONNREFUSED 127.0.0.1:8080 - The server may not be running.",
  },
  canTestClientFeatures: false,
  ...makeServerCallbacks(),
};

const connectingHttpServer: ServerCardProps = {
  name: "Staging Server",
  transport: "streamable-http",
  connectionMode: "Streamable HTTP",
  command: "https://staging.example.com/mcp",
  status: "connecting",
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
