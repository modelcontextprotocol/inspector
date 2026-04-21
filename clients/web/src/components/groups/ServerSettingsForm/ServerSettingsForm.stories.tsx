import { useState } from "react";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import type { Meta, StoryObj } from "@storybook/react-vite";
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

function InteractiveForm({
  startSettings,
  initialSections = ["connectionMode"],
}: {
  startSettings: InspectorServerSettings;
  initialSections?: ServerSettingsSection[];
}) {
  const [expandedSections, setExpandedSections] =
    useState<ServerSettingsSection[]>(initialSections);
  const [settings, setSettings] =
    useState<InspectorServerSettings>(startSettings);

  return (
    <ServerSettingsForm
      settings={settings}
      expandedSections={expandedSections}
      onExpandedSectionsChange={setExpandedSections}
      onConnectionModeChange={(mode) =>
        setSettings((s) => ({ ...s, connectionMode: mode }))
      }
      onAddHeader={() =>
        setSettings((s) => ({
          ...s,
          headers: [...s.headers, { key: "", value: "" }],
        }))
      }
      onRemoveHeader={(index) =>
        setSettings((s) => ({
          ...s,
          headers: s.headers.filter((_, i) => i !== index),
        }))
      }
      onHeaderChange={(index, key, value) =>
        setSettings((s) => ({
          ...s,
          headers: s.headers.map((h, i) => (i === index ? { key, value } : h)),
        }))
      }
      onAddMetadata={() =>
        setSettings((s) => ({
          ...s,
          metadata: [...s.metadata, { key: "", value: "" }],
        }))
      }
      onRemoveMetadata={(index) =>
        setSettings((s) => ({
          ...s,
          metadata: s.metadata.filter((_, i) => i !== index),
        }))
      }
      onMetadataChange={(index, key, value) =>
        setSettings((s) => ({
          ...s,
          metadata: s.metadata.map((m, i) =>
            i === index ? { key, value } : m,
          ),
        }))
      }
      onTimeoutChange={(field, value) =>
        setSettings((s) => ({ ...s, [field]: value }))
      }
      onOAuthChange={(field, value) => {
        const fieldMap: Record<string, string> = {
          clientId: "oauthClientId",
          clientSecret: "oauthClientSecret",
          scopes: "oauthScopes",
        };
        setSettings((s) => ({ ...s, [fieldMap[field] ?? field]: value }));
      }}
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
  render: () => <InteractiveForm startSettings={defaultSettings} />,
};

export const WithHeaders: Story = {
  render: () => (
    <InteractiveForm
      startSettings={{
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
      startSettings={{
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
      startSettings={{
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
