import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { useArgs } from "storybook/preview-api";
import {
  ServerSettingsForm,
  type ServerSettingsFormProps,
} from "./ServerSettingsForm";

const defaultSettings: InspectorServerSettings = {
  connectionMode: "proxy",
  headers: [],
  metadata: [],
  connectionTimeout: 30000,
  requestTimeout: 60000,
};

function InteractiveRender(args: ServerSettingsFormProps) {
  const [, updateArgs] = useArgs<ServerSettingsFormProps>();

  return (
    <ServerSettingsForm
      {...args}
      onExpandedSectionsChange={(sections) => {
        args.onExpandedSectionsChange(sections);
        updateArgs({ expandedSections: sections });
      }}
      onConnectionModeChange={(mode) => {
        args.onConnectionModeChange(mode);
        updateArgs({
          settings: { ...args.settings, connectionMode: mode },
        });
      }}
      onAddHeader={() => {
        args.onAddHeader();
        updateArgs({
          settings: {
            ...args.settings,
            headers: [...args.settings.headers, { key: "", value: "" }],
          },
        });
      }}
      onRemoveHeader={(index) => {
        args.onRemoveHeader(index);
        updateArgs({
          settings: {
            ...args.settings,
            headers: args.settings.headers.filter((_, i) => i !== index),
          },
        });
      }}
      onHeaderChange={(index, key, value) => {
        args.onHeaderChange(index, key, value);
        updateArgs({
          settings: {
            ...args.settings,
            headers: args.settings.headers.map((h, i) =>
              i === index ? { key, value } : h,
            ),
          },
        });
      }}
      onAddMetadata={() => {
        args.onAddMetadata();
        updateArgs({
          settings: {
            ...args.settings,
            metadata: [...args.settings.metadata, { key: "", value: "" }],
          },
        });
      }}
      onRemoveMetadata={(index) => {
        args.onRemoveMetadata(index);
        updateArgs({
          settings: {
            ...args.settings,
            metadata: args.settings.metadata.filter((_, i) => i !== index),
          },
        });
      }}
      onMetadataChange={(index, key, value) => {
        args.onMetadataChange(index, key, value);
        updateArgs({
          settings: {
            ...args.settings,
            metadata: args.settings.metadata.map((m, i) =>
              i === index ? { key, value } : m,
            ),
          },
        });
      }}
      onTimeoutChange={(field, value) => {
        args.onTimeoutChange(field, value);
        updateArgs({
          settings: { ...args.settings, [field]: value },
        });
      }}
      onOAuthChange={(field, value) => {
        args.onOAuthChange(field, value);
        const fieldMap: Record<string, string> = {
          clientId: "oauthClientId",
          clientSecret: "oauthClientSecret",
          scopes: "oauthScopes",
        };
        updateArgs({
          settings: {
            ...args.settings,
            [fieldMap[field] ?? field]: value,
          },
        });
      }}
    />
  );
}

const meta: Meta<typeof ServerSettingsForm> = {
  title: "Groups/ServerSettingsForm",
  component: ServerSettingsForm,
  render: InteractiveRender,
  args: {
    expandedSections: ["connectionMode"],
    onExpandedSectionsChange: fn(),
    onConnectionModeChange: fn(),
    onAddHeader: fn(),
    onRemoveHeader: fn(),
    onHeaderChange: fn(),
    onAddMetadata: fn(),
    onRemoveMetadata: fn(),
    onMetadataChange: fn(),
    onTimeoutChange: fn(),
    onOAuthChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ServerSettingsForm>;

export const DefaultSettings: Story = {
  args: {
    settings: defaultSettings,
  },
};

export const WithHeaders: Story = {
  args: {
    settings: {
      ...defaultSettings,
      headers: [
        { key: "Authorization", value: "Bearer token-abc-123" },
        { key: "X-Custom-Header", value: "custom-value" },
      ],
    },
  },
};

export const WithOAuth: Story = {
  args: {
    settings: {
      ...defaultSettings,
      connectionMode: "direct",
      oauthClientId: "my-client-id",
      oauthClientSecret: "super-secret-value",
      oauthScopes: "read write admin",
    },
  },
};

export const AllConfigured: Story = {
  args: {
    settings: {
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
    },
  },
};
