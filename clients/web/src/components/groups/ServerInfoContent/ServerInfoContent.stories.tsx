import type { Meta, StoryObj } from "@storybook/react-vite";
import { ServerInfoContent } from "./ServerInfoContent";

const meta: Meta<typeof ServerInfoContent> = {
  title: "Groups/ServerInfoContent",
  component: ServerInfoContent,
};

export default meta;
type Story = StoryObj<typeof ServerInfoContent>;

export const FullCapabilities: Story = {
  args: {
    name: "Everything Server",
    version: "2.1.0",
    protocolVersion: "2025-03-26",
    transport: "stdio",
    serverCapabilities: [
      { capability: "tools", supported: true, count: 12 },
      { capability: "resources", supported: true, count: 8 },
      { capability: "prompts", supported: true, count: 5 },
      { capability: "logging", supported: true },
      { capability: "completions", supported: true },
    ],
    clientCapabilities: [
      { capability: "roots", supported: true, count: 3 },
      { capability: "sampling", supported: true },
      { capability: "elicitation", supported: true },
      { capability: "experimental", supported: true },
    ],
  },
};

export const MinimalCapabilities: Story = {
  args: {
    name: "Simple Server",
    version: "1.0.0",
    protocolVersion: "2025-03-26",
    transport: "streamable-http",
    serverCapabilities: [
      { capability: "tools", supported: true, count: 2 },
      { capability: "resources", supported: false },
      { capability: "prompts", supported: false },
    ],
    clientCapabilities: [
      { capability: "roots", supported: true },
      { capability: "sampling", supported: false },
      { capability: "elicitation", supported: false },
    ],
  },
};

export const WithInstructions: Story = {
  args: {
    name: "Guided Server",
    version: "1.5.0",
    protocolVersion: "2025-03-26",
    transport: "stdio",
    serverCapabilities: [
      { capability: "tools", supported: true, count: 4 },
      { capability: "resources", supported: true, count: 2 },
      { capability: "prompts", supported: true, count: 1 },
    ],
    clientCapabilities: [
      { capability: "roots", supported: true },
      { capability: "sampling", supported: true },
    ],
    instructions:
      "This server provides access to the project management system. Use the list_projects tool first to discover available projects before querying tasks. Rate limiting applies: max 60 requests per minute.",
  },
};

export const WithOAuth: Story = {
  args: {
    name: "Authenticated Server",
    version: "3.0.0",
    protocolVersion: "2025-03-26",
    transport: "streamable-http",
    serverCapabilities: [
      { capability: "tools", supported: true, count: 6 },
      { capability: "resources", supported: true, count: 3 },
    ],
    clientCapabilities: [
      { capability: "roots", supported: true },
      { capability: "sampling", supported: false },
    ],
    oauthDetails: {
      authUrl: "https://auth.example.com/oauth2/authorize",
      scopes: ["read", "write", "admin"],
      accessToken: "eyJhbGciOiJSUzI1NiIs...truncated",
    },
  },
};
