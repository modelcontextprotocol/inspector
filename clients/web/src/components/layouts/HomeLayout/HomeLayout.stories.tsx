import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Text } from "@mantine/core";
import { HomeLayout } from "./HomeLayout";
import { ServerListScreen } from "../../organisms/ServerListScreen/ServerListScreen";
import type { ServerCardProps } from "../../molecules/ServerCard/ServerCard";

const meta: Meta<typeof HomeLayout> = {
  title: "Layouts/HomeLayout",
  component: HomeLayout,
  parameters: { layout: "fullscreen" },
  args: {
    onToggleTheme: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof HomeLayout>;

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

export const MinimalContent: Story = {
  args: {
    children: (
      <Text c="dimmed" ta="center" py="xl">
        Page content goes here
      </Text>
    ),
  },
};
