import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { useArgs } from "storybook/preview-api";
import {
  ServerSettingsModal,
  type ServerSettingsModalProps,
} from "./ServerSettingsModal";

const initialSettings: InspectorServerSettings = {
  headers: [
    { key: "Authorization", value: "Bearer token-abc-123" },
    { key: "X-Request-Id", value: "req-456" },
  ],
  env: [],
  metadata: [{ key: "userId", value: "user-789" }],
  connectionTimeout: 30000,
  requestTimeout: 60000,
  taskTtl: 60000,
  maxFetchRequests: 5000,
  oauthClientId: "my-client-id",
  oauthClientSecret: "super-secret-value",
  oauthScopes: "read write",
  roots: [
    { uri: "file:///home/user/project", name: "Project" },
    { uri: "file:///tmp" },
  ],
};

function InteractiveRender(args: ServerSettingsModalProps) {
  const [, updateArgs] = useArgs<ServerSettingsModalProps>();

  return (
    <AppShell>
      <AppShell.Main>
        <ServerSettingsModal
          {...args}
          onSettingsChange={(settings) => {
            args.onSettingsChange(settings);
            updateArgs({ settings });
          }}
        />
      </AppShell.Main>
    </AppShell>
  );
}

const meta: Meta<typeof ServerSettingsModal> = {
  title: "Groups/ServerSettingsModal",
  component: ServerSettingsModal,
  parameters: { layout: "fullscreen" },
  render: InteractiveRender,
  args: {
    opened: true,
    isStdio: false,
    onClose: fn(),
    onSettingsChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ServerSettingsModal>;

export const FullyConfigured: Story = {
  args: {
    settings: initialSettings,
  },
};

export const EmptySettings: Story = {
  args: {
    settings: {
      headers: [],
      env: [],
      metadata: [],
      connectionTimeout: 30000,
      requestTimeout: 60000,
      taskTtl: 60000,
      maxFetchRequests: 1000,
      roots: [],
    },
  },
};

// A stdio server surfaces the Working Directory field (Options) and a dedicated
// Environment Variables section.
export const StdioServer: Story = {
  args: {
    isStdio: true,
    settings: {
      headers: [],
      env: [
        { key: "API_KEY", value: "abc-123" },
        { key: "LOG_LEVEL", value: "debug" },
      ],
      metadata: [],
      connectionTimeout: 0,
      requestTimeout: 0,
      taskTtl: 60000,
      maxFetchRequests: 1000,
      cwd: "/srv/my-server",
      roots: [],
    },
  },
};
