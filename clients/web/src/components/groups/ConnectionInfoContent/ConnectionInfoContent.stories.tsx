import type {
  ClientCapabilities,
  InitializeResult,
} from "@modelcontextprotocol/client";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  ConnectionInfoContent,
  SERVER_INFO_NOT_REPORTED_LABEL,
} from "./ConnectionInfoContent";

const fullResult: InitializeResult = {
  protocolVersion: "2025-03-26",
  serverInfo: { name: "Everything Server", version: "2.1.0" },
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
    logging: {},
    completions: {},
  },
  instructions:
    "This server provides access to the project management system. Use the list_projects tool first to discover available projects before querying tasks. Rate limiting applies: max 60 requests per minute.",
};

const fullClientCaps: ClientCapabilities = {
  roots: { listChanged: true },
  sampling: {},
  elicitation: {},
  experimental: {},
};

const meta: Meta<typeof ConnectionInfoContent> = {
  title: "Groups/ConnectionInfoContent",
  component: ConnectionInfoContent,
};

export default meta;
type Story = StoryObj<typeof ConnectionInfoContent>;

export const FullCapabilities: Story = {
  args: {
    initializeResult: fullResult,
    clientCapabilities: fullClientCaps,
    transport: "stdio",
  },
};

export const ModernEra: Story = {
  args: {
    initializeResult: {
      protocolVersion: "2026-07-28",
      serverInfo: { name: "Modern Server", version: "2.0.0" },
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true },
        // The Server Extensions row reads the negotiated server capabilities
        // (era-transparent), not discoverResult — carry it here too so the
        // modern story demonstrates the extension. (#1740)
        extensions: {
          "io.modelcontextprotocol/tasks": {},
        },
      },
    },
    clientCapabilities: fullClientCaps,
    transport: "streamable-http",
    protocolEra: "modern",
    discoverResult: {
      supportedVersions: ["2026-07-28", "2025-11-25"],
      serverInfo: { name: "Modern Server", version: "2.0.0" },
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true },
        extensions: {
          "io.modelcontextprotocol/tasks": {},
        },
      },
    },
  },
};

// A modern server that omitted the optional `_meta` serverInfo stamp (#1772).
// `initializeResult.serverInfo` here is App's client-side catalog fallback, and
// `serverInfoReported: false` tells the modal not to present it as server-sent —
// Name and Version read "— (not reported by server)".
export const ServerInfoNotReported: Story = {
  args: {
    initializeResult: {
      protocolVersion: "2026-07-28",
      // The catalog name App synthesizes; must NOT surface as the reported name.
      serverInfo: { name: "my-catalog-name", version: "" },
      capabilities: { tools: { listChanged: true } },
    },
    serverInfoReported: false,
    clientCapabilities: { roots: { listChanged: true } },
    transport: "streamable-http",
    protocolEra: "modern",
    // A real modern connection that skipped the `_meta` serverInfo stamp still
    // has a discover result — with `supportedVersions` + capabilities, just no
    // `serverInfo`. Including it makes the story accurate and shows the Discovery
    // section doesn't leak a name either.
    discoverResult: {
      supportedVersions: ["2026-07-28", "2025-11-25"],
      capabilities: { tools: { listChanged: true } },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByText("my-catalog-name")).not.toBeInTheDocument();
    expect(canvas.getAllByText(SERVER_INFO_NOT_REPORTED_LABEL)).toHaveLength(2);
  },
};

export const MinimalCapabilities: Story = {
  args: {
    initializeResult: {
      protocolVersion: "2025-03-26",
      serverInfo: { name: "Simple Server", version: "1.0.0" },
      capabilities: {
        tools: { listChanged: false },
      },
    },
    clientCapabilities: {
      roots: { listChanged: true },
    },
    transport: "streamable-http",
  },
};

export const WithInstructions: Story = {
  args: {
    initializeResult: fullResult,
    clientCapabilities: {
      roots: { listChanged: true },
      sampling: {},
    },
    transport: "stdio",
  },
};

export const WithOAuth: Story = {
  args: {
    initializeResult: {
      protocolVersion: "2025-03-26",
      serverInfo: { name: "Authenticated Server", version: "3.0.0" },
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true },
      },
    },
    clientCapabilities: {
      roots: { listChanged: true },
    },
    transport: "streamable-http",
    oauth: {
      protocol: "standard",
      authorized: true,
      authUrl: "https://auth.example.com/oauth2/authorize",
      scopes: ["read", "write", "admin"],
      accessToken: "eyJhbGciOiJSUzI1NiIs...truncated",
    },
  },
};
