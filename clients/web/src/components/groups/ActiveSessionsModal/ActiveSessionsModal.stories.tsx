import { AppShell } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import type { RemoteSessionSummary } from "@inspector/core/mcp/remote/index.js";
import {
  ActiveSessionsModal,
  type ActiveSessionsModalProps,
} from "./ActiveSessionsModal";

const CAPTURED_AT = Date.parse("2026-03-01T01:00:00.000Z");

const sessions: RemoteSessionSummary[] = [
  {
    sessionId: "3f2c9a1e-7b4d-4c1a-9e2f-0a1b2c3d4e5f",
    serverName: "Everything",
    transport: "stdio",
    createdAt: "2026-03-01T00:30:00.000Z",
    consumerAttached: true,
    lastConsumerSeenAt: "2026-03-01T01:00:00.000Z",
    queuedEvents: 0,
    transportDead: false,
  },
  {
    sessionId: "8d7e6f5a-4b3c-4d2e-8f1a-9b8c7d6e5f4a",
    serverName: "Filesystem",
    transport: "stdio",
    createdAt: "2026-03-01T00:05:00.000Z",
    consumerAttached: false,
    lastConsumerSeenAt: "2026-03-01T00:59:20.000Z",
    queuedEvents: 37,
    transportDead: false,
  },
  {
    sessionId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    serverName: "Remote API",
    transport: "streamable-http",
    createdAt: "2026-03-01T00:58:00.000Z",
    consumerAttached: false,
    lastConsumerSeenAt: null,
    queuedEvents: 2,
    transportDead: true,
  },
];

function Render(args: ActiveSessionsModalProps) {
  return (
    <AppShell>
      <AppShell.Main>
        <ActiveSessionsModal {...args} />
      </AppShell.Main>
    </AppShell>
  );
}

const meta: Meta<typeof ActiveSessionsModal> = {
  title: "Groups/ActiveSessionsModal",
  component: ActiveSessionsModal,
  parameters: { layout: "fullscreen" },
  render: Render,
  args: {
    opened: true,
    sessions,
    capturedAt: CAPTURED_AT,
    loading: false,
    currentSessionId: sessions[0]!.sessionId,
    onRefresh: fn(),
    onTerminate: fn(),
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ActiveSessionsModal>;

export const WithSessions: Story = {
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText("Active Sessions")).toBeInTheDocument();
    await expect(body.getByText("This tab")).toBeInTheDocument();
    await expect(body.getByText("Detached")).toBeInTheDocument();
    body
      .getByRole("button", {
        name: `Terminate session ${sessions[1]!.sessionId}`,
      })
      .click();
    await expect(args.onTerminate).toHaveBeenCalledWith(sessions[1]!.sessionId);
  },
};

export const Terminating: Story = {
  args: { terminatingId: sessions[1]!.sessionId },
};

export const Empty: Story = {
  args: { sessions: [], currentSessionId: undefined },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(
      await body.findByText("No active sessions."),
    ).toBeInTheDocument();
  },
};

export const Failed: Story = {
  args: {
    sessions: [],
    error: "Listing sessions failed: Authentication required",
  },
};
