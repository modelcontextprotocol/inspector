import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ProtocolEntry } from "./ProtocolEntry";

const successEntry: MessageEntry = {
  id: "req-1",
  timestamp: new Date("2026-03-17T10:30:00Z"),
  direction: "request",
  origin: "client",
  message: {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_weather", arguments: { city: "San Francisco" } },
  },
  response: {
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: "18C" }],
    },
  },
  duration: 142,
};

const errorEntry: MessageEntry = {
  id: "req-2",
  timestamp: new Date("2026-03-17T10:31:15Z"),
  direction: "request",
  message: {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "query_database" },
  },
  response: {
    jsonrpc: "2.0",
    id: 2,
    error: { code: -32000, message: "Connection timeout" },
  },
  duration: 3200,
};

const resourceReadEntry: MessageEntry = {
  id: "req-3",
  timestamp: new Date("2026-03-17T10:33:00Z"),
  direction: "request",
  message: {
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: { uri: "file:///config.json" },
  },
  response: {
    jsonrpc: "2.0",
    id: 3,
    result: {
      contents: [{ uri: "file:///config.json", text: '{"debug": true}' }],
    },
  },
  duration: 45,
};

const pendingEntry: MessageEntry = {
  id: "req-4",
  timestamp: new Date("2026-03-17T10:34:00Z"),
  direction: "request",
  message: {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "long_operation" },
  },
};

const noParamsEntry: MessageEntry = {
  id: "req-5",
  timestamp: new Date("2026-03-17T10:35:00Z"),
  direction: "request",
  message: {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/list",
  },
  response: {
    jsonrpc: "2.0",
    id: 5,
    result: { tools: [] },
  },
};

const notificationEntry: MessageEntry = {
  id: "note-1",
  timestamp: new Date("2026-03-17T10:36:00Z"),
  direction: "notification",
  origin: "server",
  message: {
    jsonrpc: "2.0",
    method: "notifications/message",
    params: {
      level: "info",
      logger: "everything-server",
      data: "Roots updated: 2 root(s) received from client",
    },
  },
};

const baseProps = {
  isPinned: false,
  isListExpanded: false,
  onReplay: vi.fn(),
  onTogglePin: vi.fn(),
};

describe("ProtocolEntry", () => {
  it("renders the method, target name, status OK, and duration", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
    expect(screen.getByText("tools/call")).toBeInTheDocument();
    expect(screen.getByText("get_weather")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("142ms")).toBeInTheDocument();
  });

  it("renders the URI target for resources/read", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={resourceReadEntry} />,
    );
    expect(screen.getByText("file:///config.json")).toBeInTheDocument();
    expect(screen.getByText("resources/read")).toBeInTheDocument();
  });

  it("renders Error status when response has error", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={errorEntry} />);
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders Pending status when no response present", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={pendingEntry} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders no request-style status badge for a notification", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={notificationEntry} />,
    );
    // The method badge still labels it; there is no Pending/OK/Error badge,
    // since a fire-and-forget notification has no request lifecycle.
    expect(screen.getByText("notifications/message")).toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });

  it("shows client → server for a client-originated entry", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
    expect(screen.getByText("client → server")).toBeInTheDocument();
  });

  it("shows client ← server for a server-originated entry", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={notificationEntry} />,
    );
    expect(screen.getByText("client ← server")).toBeInTheDocument();
  });

  it("renders Pin label when not pinned", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  });

  it("renders Unpin label when pinned", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} isPinned={true} />,
    );
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
  });

  it("invokes onReplay when Replay button is clicked", async () => {
    const user = userEvent.setup();
    const onReplay = vi.fn();
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} onReplay={onReplay} />,
    );
    await user.click(screen.getByRole("button", { name: "Replay" }));
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it("hides the Replay button for a method that can't be replayed", () => {
    // A notification isn't a replayable client→server request.
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={notificationEntry} />,
    );
    expect(
      screen.queryByRole("button", { name: "Replay" }),
    ).not.toBeInTheDocument();
    // Pin stays available.
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  });

  it("orders the actions Replay, then Pin, then the expand toggle on the right", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names.indexOf("Replay")).toBeLessThan(names.indexOf("Pin"));
    expect(names.indexOf("Pin")).toBeLessThan(names.indexOf("Expand"));
  });

  it("renders the compact two-line layout with Replay as an icon when embedded", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} embedded />,
    );
    // Line 1 essentials plus the method are still shown. The timestamp is the
    // compact time-only form (not the full ISO) to fit the narrow line.
    expect(screen.getByText("10:30:00")).toBeInTheDocument();
    expect(
      screen.queryByText("2026-03-17T10:30:00.000Z"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("client → server")).toBeInTheDocument();
    expect(screen.getByText("142ms")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("tools/call")).toBeInTheDocument();
    // Replay is an icon button (aria-label), not the text button.
    expect(screen.getByRole("button", { name: "Replay" })).toBeInTheDocument();
    expect(screen.queryByText("Replay")).toBeNull();
  });

  it("keeps action order Replay, Pin, Expand in the compact layout", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} embedded />,
    );
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names.indexOf("Replay")).toBeLessThan(names.indexOf("Pin"));
    expect(names.indexOf("Pin")).toBeLessThan(names.indexOf("Expand"));
  });

  it("does not render a Replay icon for a non-replayable method when embedded", () => {
    // A server→client response isn't replayable.
    const responseEntry: MessageEntry = {
      id: "resp-1",
      timestamp: new Date("2026-03-17T10:30:00Z"),
      direction: "response",
      origin: "server",
      message: { jsonrpc: "2.0", id: 1, result: {} },
    };
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={responseEntry} embedded />,
    );
    expect(
      screen.queryByRole("button", { name: "Replay" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  });

  it("invokes onTogglePin when Pin button is clicked", async () => {
    const user = userEvent.setup();
    const onTogglePin = vi.fn();
    renderWithMantine(
      <ProtocolEntry
        {...baseProps}
        entry={successEntry}
        onTogglePin={onTogglePin}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Pin" }));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  it("toggles the local expand/collapse state when clicking Expand/Collapse", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("toggles the local expand/collapse state when clicking Expand/Collapse in the compact layout", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} embedded />,
    );
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("starts expanded when isListExpanded is true and shows Parameters and Response", () => {
    renderWithMantine(
      <ProtocolEntry
        {...baseProps}
        entry={successEntry}
        isListExpanded={true}
      />,
    );
    expect(screen.getByText("Parameters:")).toBeInTheDocument();
    expect(screen.getByText("Response:")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("syncs the local expanded state when isListExpanded prop changes", () => {
    const { rerender } = renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} />,
    );
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    rerender(
      <ProtocolEntry
        {...baseProps}
        entry={successEntry}
        isListExpanded={true}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("does not render the Parameters section when message has no params", () => {
    renderWithMantine(
      <ProtocolEntry
        {...baseProps}
        entry={noParamsEntry}
        isListExpanded={true}
      />,
    );
    expect(screen.queryByText("Parameters:")).not.toBeInTheDocument();
    expect(screen.getByText("Response:")).toBeInTheDocument();
  });

  it("does not render the Response section when no response is present", () => {
    renderWithMantine(
      <ProtocolEntry
        {...baseProps}
        entry={pendingEntry}
        isListExpanded={true}
      />,
    );
    expect(screen.getByText("Parameters:")).toBeInTheDocument();
    expect(screen.queryByText("Response:")).not.toBeInTheDocument();
  });

  it("does not render duration when duration is undefined", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={pendingEntry} />);
    expect(screen.queryByText(/ms$/)).not.toBeInTheDocument();
  });
});
