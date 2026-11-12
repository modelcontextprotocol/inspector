import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { RemoteSessionSummary } from "@inspector/core/mcp/remote/index.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  ActiveSessionsModal,
  type ActiveSessionsModalProps,
} from "./ActiveSessionsModal";

const NOW = Date.parse("2026-03-01T01:00:00.000Z");

const attached: RemoteSessionSummary = {
  sessionId: "sess-attached",
  serverName: "Everything",
  transport: "stdio",
  createdAt: "2026-03-01T00:30:00.000Z",
  consumerAttached: true,
  lastConsumerSeenAt: "2026-03-01T01:00:00.000Z",
  queuedEvents: 0,
  transportDead: false,
};

const detached: RemoteSessionSummary = {
  sessionId: "sess-detached",
  transport: "streamable-http",
  createdAt: "2026-03-01T00:00:00.000Z",
  consumerAttached: false,
  lastConsumerSeenAt: "2026-03-01T00:55:00.000Z",
  queuedEvents: 12,
  transportDead: false,
};

const closed: RemoteSessionSummary = {
  sessionId: "sess-closed",
  serverName: "Crashed",
  transport: "stdio",
  createdAt: "2026-03-01T00:59:00.000Z",
  consumerAttached: false,
  lastConsumerSeenAt: null,
  queuedEvents: 2,
  transportDead: true,
};

function renderModal(overrides: Partial<ActiveSessionsModalProps> = {}) {
  const props: ActiveSessionsModalProps = {
    opened: true,
    sessions: [attached, detached, closed],
    capturedAt: NOW,
    loading: false,
    onRefresh: vi.fn(),
    onTerminate: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  renderWithMantine(<ActiveSessionsModal {...props} />);
  return props;
}

describe("ActiveSessionsModal", () => {
  it("renders nothing while closed", () => {
    renderModal({ opened: false });
    expect(screen.queryByText("Active Sessions")).not.toBeInTheDocument();
  });

  it("lists each session with its server, status, ages and queue", () => {
    renderModal({ currentSessionId: "sess-attached" });
    expect(screen.getByText("Active Sessions")).toBeInTheDocument();
    expect(screen.getByText("Everything")).toBeInTheDocument();
    expect(screen.getByText("Unnamed server")).toBeInTheDocument();
    expect(screen.getByText("sess-detached")).toBeInTheDocument();
    expect(screen.getByText("This tab")).toBeInTheDocument();
    expect(screen.getByText("Attached")).toBeInTheDocument();
    expect(screen.getByText("Detached")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.getByText("now")).toBeInTheDocument();
    expect(screen.getByText("5m00s ago")).toBeInTheDocument();
    expect(screen.getByText("never")).toBeInTheDocument();
    expect(screen.getByText("1h00m ago")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("says so when there are no sessions", () => {
    renderModal({ sessions: [] });
    expect(screen.getByText("No active sessions.")).toBeInTheDocument();
  });

  it("shows a loading hint before any session is known", () => {
    renderModal({ sessions: [], loading: true });
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows the error", () => {
    renderModal({ error: "Listing sessions failed: HTTP 500" });
    expect(
      screen.getByText("Listing sessions failed: HTTP 500"),
    ).toBeInTheDocument();
  });

  it("terminates the chosen session", async () => {
    const user = userEvent.setup();
    const props = renderModal();
    await user.click(
      screen.getByRole("button", { name: "Terminate session sess-detached" }),
    );
    expect(props.onTerminate).toHaveBeenCalledWith("sess-detached");
  });

  it("disables the other rows while one terminate is in flight", () => {
    renderModal({ terminatingId: "sess-detached" });
    expect(
      screen.getByRole("button", { name: "Terminate session sess-attached" }),
    ).toBeDisabled();
  });

  it("refreshes on demand", async () => {
    const user = userEvent.setup();
    const props = renderModal();
    await user.click(screen.getByRole("button", { name: "Refresh sessions" }));
    expect(props.onRefresh).toHaveBeenCalled();
  });
});
