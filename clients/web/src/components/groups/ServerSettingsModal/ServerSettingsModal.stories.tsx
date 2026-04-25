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
  metadata: [{ key: "userId", value: "user-789" }],
  connectionTimeout: 30000,
  requestTimeout: 60000,
  oauthClientId: "my-client-id",
  oauthClientSecret: "super-secret-value",
  oauthScopes: "read write",
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
      metadata: [],
      connectionTimeout: 30000,
      requestTimeout: 60000,
    },
  },
};
