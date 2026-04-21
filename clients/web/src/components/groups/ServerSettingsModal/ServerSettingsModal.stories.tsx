import { useState } from "react";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ServerSettingsModal } from "./ServerSettingsModal";

const initialSettings: InspectorServerSettings = {
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
};

function InteractiveModal({
  startSettings,
}: {
  startSettings: InspectorServerSettings;
}) {
  const [settings, setSettings] =
    useState<InspectorServerSettings>(startSettings);

  return (
    <AppShell>
      <AppShell.Main>
        <ServerSettingsModal
          opened
          settings={settings}
          onClose={() => {}}
          onSettingsChange={setSettings}
        />
      </AppShell.Main>
    </AppShell>
  );
}

const meta: Meta<typeof ServerSettingsModal> = {
  title: "Groups/ServerSettingsModal",
  component: ServerSettingsModal,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof ServerSettingsModal>;

export const FullyConfigured: Story = {
  render: () => <InteractiveModal startSettings={initialSettings} />,
};

export const EmptySettings: Story = {
  render: () => (
    <InteractiveModal
      startSettings={{
        connectionMode: "proxy",
        headers: [],
        metadata: [],
        connectionTimeout: 30000,
        requestTimeout: 60000,
      }}
    />
  ),
};
