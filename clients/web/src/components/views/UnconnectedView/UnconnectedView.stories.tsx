import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { UnconnectedView } from "./UnconnectedView.js";
import { ServerListScreen } from "../../screens/ServerListScreen/ServerListScreen";
import type { ServerCardProps } from "../../groups/ServerCard/ServerCard";

const meta: Meta<typeof UnconnectedView> = {
  title: "Views/UnconnectedView",
  component: UnconnectedView,
  parameters: { layout: "fullscreen" },
  args: {
    onToggleTheme: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof UnconnectedView>;

function makeServerCallbacks(): Pick<
  ServerCardProps,
  | "onToggleConnection"
  | "onServerInfo"
  | "onSettings"
  | "onEdit"
  | "onClone"
  | "onRemove"
> {
  return {
    onToggleConnection: fn(),
    onServerInfo: fn(),
    onSettings: fn(),
    onEdit: fn(),
    onClone: fn(),
    onRemove: fn(),
  };
}

export const Empty: Story = {
  args: {
    children: (
      <ServerListScreen
        servers={[]}
        onAddManually={fn()}
        onImportConfig={fn()}
        onImportServerJson={fn()}
      />
    ),
  },
};

export const WithServers: Story = {
  args: {
    children: (
      <ServerListScreen
        servers={[
          {
            name: "everything-server",
            version: "1.0.0",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-everything",
            status: "connected",
            canTestClientFeatures: true,
            ...makeServerCallbacks(),
          },
          {
            name: "filesystem-server",
            version: "0.6.2",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command:
              "npx -y @modelcontextprotocol/server-filesystem /home/user",
            status: "disconnected",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "remote-server",
            version: "2.1.0",
            transport: "http",
            connectionMode: "Direct",
            command: "https://api.example.com/mcp",
            status: "failed",
            retryCount: 3,
            error: { message: "Connection timeout after 20s" },
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
        ]}
        onAddManually={fn()}
        onImportConfig={fn()}
        onImportServerJson={fn()}
      />
    ),
  },
};

export const ManyServers: Story = {
  args: {
    children: (
      <ServerListScreen
        servers={[
          {
            name: "everything-server",
            version: "1.0.0",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-everything",
            status: "connected",
            canTestClientFeatures: true,
            ...makeServerCallbacks(),
          },
          {
            name: "filesystem-server",
            version: "0.6.2",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command:
              "npx -y @modelcontextprotocol/server-filesystem /home/user",
            status: "disconnected",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "remote-api-server",
            version: "2.1.0",
            transport: "http",
            connectionMode: "Direct",
            command: "https://api.example.com/mcp",
            status: "connected",
            canTestClientFeatures: true,
            ...makeServerCallbacks(),
          },
          {
            name: "postgres-server",
            version: "1.3.0",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-postgres",
            status: "connecting",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "github-server",
            version: "0.9.1",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-github",
            status: "connected",
            canTestClientFeatures: true,
            ...makeServerCallbacks(),
          },
          {
            name: "slack-server",
            version: "1.1.0",
            transport: "http",
            connectionMode: "Direct",
            command: "https://slack-mcp.example.com/mcp",
            status: "failed",
            retryCount: 5,
            error: { message: "Authentication failed" },
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "memory-server",
            version: "0.2.0",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-memory",
            status: "connected",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "puppeteer-server",
            version: "1.0.3",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-puppeteer",
            status: "disconnected",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "sqlite-server",
            version: "0.5.1",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-sqlite ./data.db",
            status: "connected",
            canTestClientFeatures: true,
            ...makeServerCallbacks(),
          },
          {
            name: "brave-search-server",
            version: "1.2.0",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-brave-search",
            status: "failed",
            retryCount: 2,
            error: { message: "API key expired" },
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "google-maps-server",
            version: "0.8.0",
            transport: "http",
            connectionMode: "Direct",
            command: "https://maps-mcp.example.com/mcp",
            status: "disconnected",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "sequential-thinking-server",
            version: "1.4.2",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-sequential-thinking",
            status: "connecting",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
        ]}
        onAddManually={fn()}
        onImportConfig={fn()}
        onImportServerJson={fn()}
      />
    ),
  },
};

export const Connecting: Story = {
  args: {
    children: (
      <ServerListScreen
        servers={[
          {
            name: "everything-server",
            version: "1.0.0",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-everything",
            status: "connecting",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
        ]}
        onAddManually={fn()}
        onImportConfig={fn()}
        onImportServerJson={fn()}
      />
    ),
  },
};
