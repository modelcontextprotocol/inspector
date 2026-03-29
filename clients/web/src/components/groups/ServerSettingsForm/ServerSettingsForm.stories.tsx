import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ServerSettingsForm } from "./ServerSettingsForm";

const meta: Meta<typeof ServerSettingsForm> = {
  title: "Groups/ServerSettingsForm",
  component: ServerSettingsForm,
  args: {
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
    connectionMode: "proxy",
    headers: [],
    metadata: [],
    connectionTimeout: 30000,
    requestTimeout: 60000,
  },
};

export const WithHeaders: Story = {
  args: {
    connectionMode: "proxy",
    headers: [
      { key: "Authorization", value: "Bearer token-abc-123" },
      { key: "X-Custom-Header", value: "custom-value" },
    ],
    metadata: [],
    connectionTimeout: 30000,
    requestTimeout: 60000,
  },
};

export const WithOAuth: Story = {
  args: {
    connectionMode: "direct",
    headers: [],
    metadata: [],
    connectionTimeout: 30000,
    requestTimeout: 60000,
    oauthClientId: "my-client-id",
    oauthClientSecret: "super-secret-value",
    oauthScopes: "read write admin",
  },
};

export const AllConfigured: Story = {
  args: {
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
};
