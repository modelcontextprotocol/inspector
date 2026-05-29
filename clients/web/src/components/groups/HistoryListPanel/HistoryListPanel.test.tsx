import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { HistoryListPanel } from "./HistoryListPanel";

const sampleEntries: MessageEntry[] = [
  {
    id: "req-1",
    timestamp: new Date("2026-03-17T10:00:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "send_message", arguments: { message: "Hello!" } },
    },
    response: {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "Sent" }] },
    },
    duration: 120,
  },
  {
    id: "req-2",
    timestamp: new Date("2026-03-17T10:01:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: { uri: "file:///config.json" },
    },
    response: {
      jsonrpc: "2.0",
      id: 2,
      result: {
        contents: [{ uri: "file:///config.json", text: "{}" }],
      },
    },
    duration: 45,
  },
  {
    id: "req-3",
    timestamp: new Date("2026-03-17T10:02:00Z"),
    direction: "request",
    message: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
    },
    response: {
      jsonrpc: "2.0",
      id: 3,
      result: { tools: [] },
    },
    duration: 80,
  },
];

const baseProps = {
  pinnedIds: new Set<string>(),
  searchText: "",
  onClearAll: vi.fn(),
  onExport: vi.fn(),
  onReplay: vi.fn(),
  onTogglePin: vi.fn(),
  sortDirection: "newest-first" as const,
  onSortChange: vi.fn(),
  compact: true,
  onToggleCompact: vi.fn(),
};

describe("HistoryListPanel", () => {
  it("renders the title and Export button", () => {
    renderWithMantine(<HistoryListPanel {...baseProps} entries={[]} />);
    expect(screen.getByText("Requests")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("renders the empty state when there are no entries", () => {
    renderWithMantine(<HistoryListPanel {...baseProps} entries={[]} />);
    expect(screen.getByText("No request history")).toBeInTheDocument();
  });

  it("renders the empty state when entries exist but none match the filter", () => {
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={sampleEntries}
        searchText="zzznotfound"
      />,
    );
    expect(screen.getByText("No request history")).toBeInTheDocument();
  });

  it("renders the History title with count for unpinned entries", () => {
    renderWithMantine(
      <HistoryListPanel {...baseProps} entries={sampleEntries} />,
    );
    expect(screen.getByText("History (3)")).toBeInTheDocument();
  });

  it("renders the Pinned title with count when entries are pinned", () => {
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={sampleEntries}
        pinnedIds={new Set(["req-1"])}
      />,
    );
    expect(screen.getByText("Pinned Requests (1)")).toBeInTheDocument();
    expect(screen.getByText("History (2)")).toBeInTheDocument();
  });

  it("filters entries by searchText (case-insensitive)", () => {
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={sampleEntries}
        searchText="config.json"
      />,
    );
    expect(screen.getByText("History (1)")).toBeInTheDocument();
  });

  it("filters entries by methodFilter", () => {
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={sampleEntries}
        methodFilter="tools/list"
      />,
    );
    expect(screen.getByText("History (1)")).toBeInTheDocument();
  });

  it("invokes onExport when Export is clicked", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={sampleEntries}
        onExport={onExport}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("invokes onClearAll when Clear is clicked", async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={sampleEntries}
        onClearAll={onClearAll}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("invokes onReplay with the entry id when Replay is clicked", async () => {
    const user = userEvent.setup();
    const onReplay = vi.fn();
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={[sampleEntries[0]]}
        onReplay={onReplay}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Replay" }));
    expect(onReplay).toHaveBeenCalledWith("req-1");
  });

  it("invokes onTogglePin with the entry id when Pin is clicked", async () => {
    const user = userEvent.setup();
    const onTogglePin = vi.fn();
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={[sampleEntries[0]]}
        onTogglePin={onTogglePin}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Pin" }));
    expect(onTogglePin).toHaveBeenCalledWith("req-1");
  });

  it("renders only pinned section when all entries are pinned", () => {
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={[sampleEntries[0]]}
        pinnedIds={new Set(["req-1"])}
      />,
    );
    expect(screen.getByText("Pinned Requests (1)")).toBeInTheDocument();
    expect(screen.queryByText(/^History \(/)).not.toBeInTheDocument();
  });

  it("invokes onReplay and onTogglePin from the pinned section", async () => {
    const user = userEvent.setup();
    const onReplay = vi.fn();
    const onTogglePin = vi.fn();
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={[sampleEntries[0]]}
        pinnedIds={new Set(["req-1"])}
        onReplay={onReplay}
        onTogglePin={onTogglePin}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Replay" }));
    expect(onReplay).toHaveBeenCalledWith("req-1");
    await user.click(screen.getByRole("button", { name: "Unpin" }));
    expect(onTogglePin).toHaveBeenCalledWith("req-1");
  });

  it("renders entries newest-first by default", () => {
    renderWithMantine(
      <HistoryListPanel {...baseProps} entries={sampleEntries} />,
    );
    const methods = screen.getAllByText(
      /tools\/call|resources\/read|tools\/list/,
    );
    expect(methods[0]).toHaveTextContent("tools/list");
    expect(methods[methods.length - 1]).toHaveTextContent("tools/call");
  });

  it("reorders entries when sortDirection is oldest-first", () => {
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={sampleEntries}
        sortDirection="oldest-first"
      />,
    );
    const methods = screen.getAllByText(
      /tools\/call|resources\/read|tools\/list/,
    );
    expect(methods[0]).toHaveTextContent("tools/call");
    expect(methods[methods.length - 1]).toHaveTextContent("tools/list");
  });

  it("invokes onSortChange when the user picks a new sort", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={sampleEntries}
        onSortChange={onSortChange}
      />,
    );
    await user.click(
      screen.getByRole("textbox", { name: "History sort direction" }),
    );
    await user.click(await screen.findByText("Sort: Oldest First"));
    expect(onSortChange).toHaveBeenCalledWith("oldest-first");
  });

  it("renders entries collapsed when compact is true (default parity with Network)", () => {
    renderWithMantine(
      <HistoryListPanel {...baseProps} entries={sampleEntries} compact />,
    );
    expect(
      screen.getAllByRole("button", { name: "Expand" }).length,
    ).toBeGreaterThan(0);
  });

  it("renders entries expanded when compact is false", () => {
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={sampleEntries}
        compact={false}
      />,
    );
    expect(
      screen.getAllByRole("button", { name: "Collapse" }).length,
    ).toBeGreaterThan(0);
  });

  it("invokes onToggleCompact when the ListToggle is clicked", async () => {
    const user = userEvent.setup();
    const onToggleCompact = vi.fn();
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={sampleEntries}
        onToggleCompact={onToggleCompact}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(onToggleCompact).toHaveBeenCalledTimes(1);
  });
});
