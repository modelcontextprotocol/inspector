import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, CloseButton, Group, Modal, Title } from "@mantine/core";
import { fn } from "storybook/test";
import { UnconnectedView } from "./UnconnectedView.js";
import { ServerListScreen } from "../../screens/ServerListScreen/ServerListScreen";
import {
  ServerSettingsForm,
  type ServerSettingsSection,
} from "../../groups/ServerSettingsForm/ServerSettingsForm";

const ALL_SETTINGS_SECTIONS: ServerSettingsSection[] = [
  "connectionMode",
  "headers",
  "metadata",
  "timeouts",
  "oauth",
];
import { ListToggle } from "../../elements/ListToggle/ListToggle";
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
            status: "disconnected",
            canTestClientFeatures: false,
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
            status: "disconnected",
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

function SettingsModalStory() {
  const [expandedSections, setExpandedSections] = useState<
    ServerSettingsSection[]
  >(["connectionMode"]);
  const allExpanded = expandedSections.length === ALL_SETTINGS_SECTIONS.length;
  return (
    <UnconnectedView onToggleTheme={fn()}>
      <ServerListScreen
        servers={[
          {
            name: "everything-server",
            version: "1.0.0",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-everything",
            status: "disconnected",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
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
            <ListToggle
              compact={allExpanded}
              variant="subtle"
              onToggle={() =>
                setExpandedSections(allExpanded ? [] : ALL_SETTINGS_SECTIONS)
              }
            />
            <Title order={4} ta="center" style={{ flex: 1 }}>
              Server Settings
            </Title>
            <Box>
              <CloseButton onClick={fn()} />
            </Box>
          </Group>
        }
        size="lg"
        centered
        styles={{ title: { flex: 1 } }}
      >
        <ServerSettingsForm
          connectionMode="proxy"
          headers={[
            { key: "Authorization", value: "Bearer token-abc-123" },
            { key: "X-Request-Id", value: "req-456" },
          ]}
          metadata={[{ key: "userId", value: "user-789" }]}
          connectionTimeout={30000}
          requestTimeout={60000}
          oauthClientId="my-client-id"
          oauthClientSecret="super-secret-value"
          oauthScopes="read write"
          expandedSections={expandedSections}
          onExpandedSectionsChange={setExpandedSections}
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
          {
            name: "everything-server",
            version: "1.0.0",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-everything",
            status: "disconnected",
            canTestClientFeatures: false,
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
            status: "disconnected",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "postgres-server",
            version: "1.3.0",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-postgres",
            status: "disconnected",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "github-server",
            version: "0.9.1",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-github",
            status: "disconnected",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "slack-server",
            version: "1.1.0",
            transport: "http",
            connectionMode: "Direct",
            command: "https://slack-mcp.example.com/mcp",
            status: "disconnected",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "memory-server",
            version: "0.2.0",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-memory",
            status: "disconnected",
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
            status: "disconnected",
            canTestClientFeatures: false,
            ...makeServerCallbacks(),
          },
          {
            name: "brave-search-server",
            version: "1.2.0",
            transport: "stdio",
            connectionMode: "Via Proxy",
            command: "npx -y @modelcontextprotocol/server-brave-search",
            status: "disconnected",
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
            status: "disconnected",
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
