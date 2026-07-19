import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { useArgs } from "storybook/preview-api";
import {
  ServerSettingsForm,
  type ServerSettingsFormProps,
} from "./ServerSettingsForm";

const defaultSettings: InspectorServerSettings = {
  headers: [],
  env: [],
  metadata: [],
  connectionTimeout: 30000,
  requestTimeout: 60000,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  roots: [],
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
      onAddEnv={() => {
        args.onAddEnv();
        updateArgs({
          settings: {
            ...args.settings,
            env: [...args.settings.env, { key: "", value: "" }],
          },
        });
      }}
      onRemoveEnv={(index) => {
        args.onRemoveEnv(index);
        updateArgs({
          settings: {
            ...args.settings,
            env: args.settings.env.filter((_, i) => i !== index),
          },
        });
      }}
      onEnvChange={(index, key, value) => {
        args.onEnvChange(index, key, value);
        updateArgs({
          settings: {
            ...args.settings,
            env: args.settings.env.map((e, i) =>
              i === index ? { key, value } : e,
            ),
          },
        });
      }}
      onCwdChange={(value) => {
        args.onCwdChange(value);
        updateArgs({ settings: { ...args.settings, cwd: value } });
      }}
      onTimeoutChange={(field, value) => {
        args.onTimeoutChange(field, value);
        updateArgs({
          settings: { ...args.settings, [field]: value },
        });
      }}
      onAutoRefreshChange={(value) => {
        args.onAutoRefreshChange(value);
        updateArgs({
          settings: { ...args.settings, autoRefreshOnListChanged: value },
        });
      }}
      onPaginatedListsChange={(value) => {
        args.onPaginatedListsChange(value);
        updateArgs({
          settings: { ...args.settings, paginatedLists: value },
        });
      }}
      onMaxFetchRequestsChange={(value) => {
        args.onMaxFetchRequestsChange(value);
        updateArgs({
          settings: { ...args.settings, maxFetchRequests: value },
        });
      }}
      onProtocolEraChange={(value) => {
        args.onProtocolEraChange(value);
        updateArgs({
          settings: { ...args.settings, protocolEra: value },
        });
      }}
      onOAuthChange={(oauth) => {
        args.onOAuthChange(oauth);
        updateArgs({
          settings: {
            ...args.settings,
            oauthClientId: oauth.clientId,
            oauthClientSecret: oauth.clientSecret,
            oauthScopes: oauth.scopes,
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
    isStdio: false,
    expandedSections: ["options"],
    onExpandedSectionsChange: fn(),
    onAddHeader: fn(),
    onRemoveHeader: fn(),
    onHeaderChange: fn(),
    onAddEnv: fn(),
    onRemoveEnv: fn(),
    onEnvChange: fn(),
    onCwdChange: fn(),
    onAddMetadata: fn(),
    onRemoveMetadata: fn(),
    onMetadataChange: fn(),
    onTimeoutChange: fn(),
    onAutoRefreshChange: fn(),
    onPaginatedListsChange: fn(),
    onMaxFetchRequestsChange: fn(),
    onProtocolEraChange: fn(),
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
    expandedSections: ["headers"],
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
      oauthClientId: "my-client-id",
      oauthClientSecret: "super-secret-value",
      oauthScopes: "read write admin",
    },
  },
};

export const AllConfigured: Story = {
  args: {
    settings: {
      headers: [
        { key: "Authorization", value: "Bearer token-abc-123" },
        { key: "X-Request-Id", value: "req-456" },
      ],
      env: [],
      metadata: [
        { key: "userId", value: "user-789" },
        { key: "sessionId", value: "session-012" },
      ],
      connectionTimeout: 15000,
      requestTimeout: 45000,
      taskTtl: 45000,
      maxFetchRequests: 5000,
      oauthClientId: "my-client-id",
      oauthClientSecret: "super-secret-value",
      oauthScopes: "read write",
      roots: [
        { uri: "file:///home/user/project", name: "Project" },
        { uri: "file:///tmp" },
      ],
    },
  },
};

export const StdioEnvironment: Story = {
  args: {
    isStdio: true,
    expandedSections: ["options", "environment"],
    settings: {
      ...defaultSettings,
      cwd: "/srv/my-server",
      env: [
        { key: "API_KEY", value: "abc-123" },
        { key: "LOG_LEVEL", value: "debug" },
      ],
    },
  },
};
