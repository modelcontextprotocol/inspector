import type { Meta, StoryObj } from "@storybook/react-vite";
import { CloseButton, Group, Modal, Title } from "@mantine/core";
import { fn } from "storybook/test";
import { UnconnectedView } from "./UnconnectedView.js";
import { ServerListScreen } from "../../screens/ServerListScreen/ServerListScreen";
import { ServerSettingsForm } from "../../groups/ServerSettingsForm/ServerSettingsForm";
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

function makeStdioServer(
  name: string,
  version: string,
  command: string,
): ServerCardProps {
  return {
    name,
    config: { command },
    info: { name, version },
    connection: { status: "disconnected" },
    connectionMode: "Via Proxy",
    canTestClientFeatures: false,
    ...makeServerCallbacks(),
  };
}

function makeHttpServer(
  name: string,
  version: string,
  url: string,
): ServerCardProps {
  return {
    name,
    config: { type: "streamable-http", url },
    info: { name, version },
    connection: { status: "disconnected" },
    connectionMode: "Direct",
    canTestClientFeatures: false,
    ...makeServerCallbacks(),
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
          makeStdioServer(
            "everything-server",
            "1.0.0",
            "npx -y @modelcontextprotocol/server-everything",
          ),
          makeStdioServer(
            "filesystem-server",
            "0.6.2",
            "npx -y @modelcontextprotocol/server-filesystem /home/user",
          ),
          makeHttpServer(
            "remote-server",
            "2.1.0",
            "https://api.example.com/mcp",
          ),
        ]}
        onAddManually={fn()}
        onImportConfig={fn()}
        onImportServerJson={fn()}
      />
    ),
  },
};

function SettingsModalStory() {
  return (
    <UnconnectedView onToggleTheme={fn()}>
      <ServerListScreen
        servers={[
          makeStdioServer(
            "everything-server",
            "1.0.0",
            "npx -y @modelcontextprotocol/server-everything",
          ),
        ]}
        onAddManually={fn()}
        onImportConfig={fn()}
        onImportServerJson={fn()}
      />
      <Modal
        opened
        onClose={fn()}
        withCloseButton={false}
        title={
          <Group justify="space-between" wrap="nowrap" w="100%">
            <Title order={4} ta="center" style={{ flex: 1 }}>
              Server Settings
            </Title>
            <CloseButton onClick={fn()} />
          </Group>
        }
        size="lg"
        centered
        styles={{ title: { flex: 1 } }}
      >
        <ServerSettingsForm
          settings={{
            connectionMode: "proxy",
            headers: [
              { key: "Authorization", value: "Bearer token-abc-123" },
              { key: "X-Request-Id", value: "req-456" },
            ],
            metadata: [{ key: "userId", value: "user-789" }],
            connectionTimeout: 30000,
            requestTimeout: 60000,
            oauthClientId: "my-client-id",
            oauthClientSecret: "super-secret-value",
            oauthScopes: "read write",
          }}
          onConnectionModeChange={fn()}
          onAddHeader={fn()}
          onRemoveHeader={fn()}
          onHeaderChange={fn()}
          onAddMetadata={fn()}
          onRemoveMetadata={fn()}
          onMetadataChange={fn()}
          onTimeoutChange={fn()}
          onOAuthChange={fn()}
        />
      </Modal>
    </UnconnectedView>
  );
}

export const WithSettingsModal: Story = {
  render: () => <SettingsModalStory />,
};

export const ManyServers: Story = {
  args: {
    children: (
      <ServerListScreen
        servers={[
          makeStdioServer(
            "everything-server",
            "1.0.0",
            "npx -y @modelcontextprotocol/server-everything",
          ),
          makeStdioServer(
            "filesystem-server",
            "0.6.2",
            "npx -y @modelcontextprotocol/server-filesystem /home/user",
          ),
          makeHttpServer(
            "remote-api-server",
            "2.1.0",
            "https://api.example.com/mcp",
          ),
          makeStdioServer(
            "postgres-server",
            "1.3.0",
            "npx -y @modelcontextprotocol/server-postgres",
          ),
          makeStdioServer(
            "github-server",
            "0.9.1",
            "npx -y @modelcontextprotocol/server-github",
          ),
          makeHttpServer(
            "slack-server",
            "1.1.0",
            "https://slack-mcp.example.com/mcp",
          ),
          makeStdioServer(
            "memory-server",
            "0.2.0",
            "npx -y @modelcontextprotocol/server-memory",
          ),
          makeStdioServer(
            "puppeteer-server",
            "1.0.3",
            "npx -y @modelcontextprotocol/server-puppeteer",
          ),
          makeStdioServer(
            "sqlite-server",
            "0.5.1",
            "npx -y @modelcontextprotocol/server-sqlite ./data.db",
          ),
          makeStdioServer(
            "brave-search-server",
            "1.2.0",
            "npx -y @modelcontextprotocol/server-brave-search",
          ),
          makeHttpServer(
            "google-maps-server",
            "0.8.0",
            "https://maps-mcp.example.com/mcp",
          ),
          makeStdioServer(
            "sequential-thinking-server",
            "1.4.2",
            "npx -y @modelcontextprotocol/server-sequential-thinking",
          ),
        ]}
        onAddManually={fn()}
        onImportConfig={fn()}
        onImportServerJson={fn()}
      />
    ),
  },
};
