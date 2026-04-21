import { useState } from "react";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import {
  ServerSettingsForm,
  type ServerSettingsSection,
} from "./ServerSettingsForm";

const defaultSettings: InspectorServerSettings = {
  connectionMode: "proxy",
  headers: [],
  metadata: [],
  connectionTimeout: 30000,
  requestTimeout: 60000,
};

const defaultHandlers = {
  onConnectionModeChange: fn(),
  onAddHeader: fn(),
  onRemoveHeader: fn(),
  onHeaderChange: fn(),
  onAddMetadata: fn(),
  onRemoveMetadata: fn(),
  onMetadataChange: fn(),
  onTimeoutChange: fn(),
  onOAuthChange: fn(),
};

function InteractiveForm({
  settings,
  initialSections = ["connectionMode"],
}: {
  settings: InspectorServerSettings;
  initialSections?: ServerSettingsSection[];
}) {
  const [expandedSections, setExpandedSections] =
    useState<ServerSettingsSection[]>(initialSections);

  return (
    <ServerSettingsForm
      settings={settings}
      expandedSections={expandedSections}
      onExpandedSectionsChange={setExpandedSections}
      {...defaultHandlers}
    />
  );
}

const meta: Meta<typeof ServerSettingsForm> = {
  title: "Groups/ServerSettingsForm",
  component: ServerSettingsForm,
};

export default meta;
type Story = StoryObj<typeof ServerSettingsForm>;

export const DefaultSettings: Story = {
  render: () => <InteractiveForm settings={defaultSettings} />,
};

export const WithHeaders: Story = {
  render: () => (
    <InteractiveForm
      settings={{
        ...defaultSettings,
        headers: [
          { key: "Authorization", value: "Bearer token-abc-123" },
          { key: "X-Custom-Header", value: "custom-value" },
        ],
      }}
    />
  ),
};

export const WithOAuth: Story = {
  render: () => (
    <InteractiveForm
      settings={{
        ...defaultSettings,
        connectionMode: "direct",
        oauthClientId: "my-client-id",
        oauthClientSecret: "super-secret-value",
        oauthScopes: "read write admin",
      }}
    />
  ),
};

export const AllConfigured: Story = {
  render: () => (
    <InteractiveForm
      settings={{
        connectionMode: "proxy",
        headers: [
          { key: "Authorization", value: "Bearer token-abc-123" },
          { key: "X-Request-Id", value: "req-456" },
        ],
        metadata: [
          { key: "userId", value: "user-789" },
          { key: "sessionId", value: "session-012" },
        ],
        connectionTimeout: 15000,
        requestTimeout: 45000,
        oauthClientId: "my-client-id",
        oauthClientSecret: "super-secret-value",
        oauthScopes: "read write",
      }}
    />
  ),
};
