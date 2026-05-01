import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { HistoryEntry } from "./HistoryEntry";

const successEntry: MessageEntry = {
  id: "req-1",
  timestamp: new Date("2026-03-17T10:30:00Z"),
  direction: "request",
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

const baseProps = {
  isPinned: false,
  isListExpanded: false,
  onReplay: vi.fn(),
  onTogglePin: vi.fn(),
};

describe("HistoryEntry", () => {
  it("renders the method, target name, status OK, and duration", () => {
    renderWithMantine(<HistoryEntry {...baseProps} entry={successEntry} />);
    expect(screen.getByText("tools/call")).toBeInTheDocument();
    expect(screen.getByText("get_weather")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("142ms")).toBeInTheDocument();
  });

  it("renders the URI target for resources/read", () => {
    renderWithMantine(
      <HistoryEntry {...baseProps} entry={resourceReadEntry} />,
    );
    expect(screen.getByText("file:///config.json")).toBeInTheDocument();
    expect(screen.getByText("resources/read")).toBeInTheDocument();
  });

  it("renders Error status when response has error", () => {
    renderWithMantine(<HistoryEntry {...baseProps} entry={errorEntry} />);
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders Pending status when no response present", () => {
    renderWithMantine(<HistoryEntry {...baseProps} entry={pendingEntry} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders Pin label when not pinned", () => {
    renderWithMantine(<HistoryEntry {...baseProps} entry={successEntry} />);
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  });

  it("renders Unpin label when pinned", () => {
    renderWithMantine(
      <HistoryEntry {...baseProps} entry={successEntry} isPinned={true} />,
    );
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
  });

  it("invokes onReplay when Replay button is clicked", async () => {
    const user = userEvent.setup();
    const onReplay = vi.fn();
    renderWithMantine(
      <HistoryEntry {...baseProps} entry={successEntry} onReplay={onReplay} />,
    );
    await user.click(screen.getByRole("button", { name: "Replay" }));
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it("invokes onTogglePin when Pin button is clicked", async () => {
    const user = userEvent.setup();
    const onTogglePin = vi.fn();
    renderWithMantine(
      <HistoryEntry
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
    renderWithMantine(<HistoryEntry {...baseProps} entry={successEntry} />);
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("starts expanded when isListExpanded is true and shows Parameters and Response", () => {
    renderWithMantine(
      <HistoryEntry
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
      <HistoryEntry {...baseProps} entry={successEntry} />,
    );
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    rerender(
      <HistoryEntry
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
      <HistoryEntry
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
      <HistoryEntry
        {...baseProps}
        entry={pendingEntry}
        isListExpanded={true}
      />,
    );
    expect(screen.getByText("Parameters:")).toBeInTheDocument();
    expect(screen.queryByText("Response:")).not.toBeInTheDocument();
  });

  it("does not render duration when duration is undefined", () => {
    renderWithMantine(<HistoryEntry {...baseProps} entry={pendingEntry} />);
    expect(screen.queryByText(/ms$/)).not.toBeInTheDocument();
  });
});
