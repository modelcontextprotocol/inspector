import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import { expectScrollbarGutterIdleHidden } from "../../../test/scrollAreaStoryAssertions";
import { ServerListScreen } from "./ServerListScreen";

const meta: Meta<typeof ServerListScreen> = {
  title: "Screens/ServerListScreen",
  component: ServerListScreen,
  parameters: { layout: "fullscreen" },
  args: {
    onAddManually: fn(),
    onImportConfig: fn(),
    onImportServerJson: fn(),
    onExport: fn(),
    onToggleConnection: fn(),
    onConnectionInfo: fn(),
    onSettings: fn(),
    onEdit: fn(),
    onClone: fn(),
    onRemove: fn(),
    onReorder: fn(),
    compact: false,
    onToggleCompact: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ServerListScreen>;

const connectedStdioServer: ServerEntry = {
  id: "5e8c3d1f-2a4b-4c6d-8e7f-1a2b3c4d5e6f",
  name: "Local Dev Server",
  config: {
    command: "npx @modelcontextprotocol/server-filesystem /home/user/projects",
  },
  info: { name: "Local Dev Server", version: "1.2.0" },
  connection: { status: "connected" },
};

const disconnectedStdioServer: ServerEntry = {
  id: "b3a7c1d2-9f8e-4a5b-bc6d-7e8f9a0b1c2d",
  name: "Database Tools",
  config: {
    command: "python -m mcp_server_sqlite --db-path ./data.db",
  },
  info: { name: "Database Tools", version: "0.9.1" },
  connection: { status: "disconnected" },
};

const failedHttpServer: ServerEntry = {
  id: "c4d5e6f7-8a9b-4c0d-9e1f-2a3b4c5d6e7f",
  name: "Remote API Server",
  config: {
    type: "streamable-http",
    url: "https://api.example.com/mcp",
  },
  info: { name: "Remote API Server", version: "2.0.0" },
  connection: {
    status: "error",
    retryCount: 3,
    error: {
      message: "Connection refused",
      details: "ECONNREFUSED 127.0.0.1:8080 - The server may not be running.",
    },
  },
};

const connectingHttpServer: ServerEntry = {
  id: "d6e7f8a9-0b1c-4d2e-bf3a-4b5c6d7e8f90",
  name: "Staging Server",
  config: {
    type: "streamable-http",
    url: "https://staging.example.com/mcp",
  },
  connection: { status: "connecting" },
};

export const MultipleServers: Story = {
  args: {
    servers: [connectedStdioServer, disconnectedStdioServer, failedHttpServer],
  },
  // The server grid scroll region reserves a scrollbar gutter and hides the
  // bar when idle, matching the Protocol/Network/Logging list panels (#1474).
  play: async ({ canvasElement }) => {
    expectScrollbarGutterIdleHidden(canvasElement);
  },
};

export const SingleServer: Story = {
  args: {
    servers: [connectedStdioServer],
  },
};

export const Empty: Story = {
  args: {
    servers: [],
  },
};

export const MixedStates: Story = {
  args: {
    servers: [
      connectedStdioServer,
      disconnectedStdioServer,
      failedHttpServer,
      connectingHttpServer,
    ],
  },
};

export const WithActiveServer: Story = {
  args: {
    servers: [connectedStdioServer, disconnectedStdioServer, failedHttpServer],
    activeServer: connectedStdioServer.id,
  },
};

/**
 * Accessible keyboard reorder: focus a card's grip, press Space to pick it up,
 * an arrow key to move it, and Space again to drop. Runs in a real browser
 * (via the storybook test runner) where layout rects exist for the `@dnd-kit`
 * keyboard sensor — the path that's unreliable under happy-dom. At the default
 * 1280px viewport the grid is three columns wide, so ArrowRight moves the
 * first card one position to the right.
 */
export const KeyboardReorder: Story = {
  args: {
    servers: [connectedStdioServer, disconnectedStdioServer, failedHttpServer],
  },
  play: async ({ canvasElement, args, step }) => {
    const canvas = within(canvasElement);
    const handle = await canvas.findByRole("button", {
      name: "Reorder Local Dev Server",
    });

    await step("pick up the first card", async () => {
      handle.focus();
      await userEvent.keyboard("[Space]");
    });
    await step("move it one position to the right", async () => {
      await userEvent.keyboard("[ArrowRight]");
    });
    await step("drop it", async () => {
      await userEvent.keyboard("[Space]");
    });

    await waitFor(() => expect(args.onReorder).toHaveBeenCalled());
    // The first card swapped places with the second; the third is unmoved.
    expect(args.onReorder).toHaveBeenCalledWith([
      disconnectedStdioServer.id,
      connectedStdioServer.id,
      failedHttpServer.id,
    ]);
  },
};
