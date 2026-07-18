import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ProtocolListPanel } from "./ProtocolListPanel";

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
  visibleDirections: { client: true, server: true },
  onClearAll: vi.fn(),
  onExport: vi.fn(),
  onClearSection: vi.fn(),
  onExportSection: vi.fn(),
  onReplay: vi.fn(),
  onTogglePin: vi.fn(),
  sortDirection: "newest-first" as const,
  onSortChange: vi.fn(),
  compact: true,
  onToggleCompact: vi.fn(),
};

describe("ProtocolListPanel", () => {
  it("renders the title and Export button", () => {
    renderWithMantine(<ProtocolListPanel {...baseProps} entries={[]} />);
    expect(screen.getByText("Messages")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("renders the empty state when there are no entries", () => {
    renderWithMantine(<ProtocolListPanel {...baseProps} entries={[]} />);
    expect(screen.getByText("No request history")).toBeInTheDocument();
  });

  it("renders the empty state when entries exist but none match the filter", () => {
    renderWithMantine(
      <ProtocolListPanel
        {...baseProps}
        entries={sampleEntries}
        searchText="zzznotfound"
      />,
    );
    expect(screen.getByText("No request history")).toBeInTheDocument();
  });

  it("hides the History header when there are no pinned entries", () => {
    renderWithMantine(
      <ProtocolListPanel {...baseProps} entries={sampleEntries} />,
    );
    // With no pinned section to distinguish it from, the header is dropped...
    expect(screen.queryByText("History (3)")).toBeNull();
    // ...but the entries themselves are still shown.
    expect(screen.getByText("resources/read")).toBeInTheDocument();
  });

  it("renders the Pinned title with count when entries are pinned", () => {
    renderWithMantine(
      <ProtocolListPanel
        {...baseProps}
        entries={sampleEntries}
        pinnedIds={new Set(["req-1"])}
      />,
    );
    expect(screen.getByText("Pinned Messages (1)")).toBeInTheDocument();
    expect(screen.getByText("History (2)")).toBeInTheDocument();
  });

  it("toggles a section's expanded state when its header is clicked", async () => {
    const user = userEvent.setup();
    // Both sections present so the headers are collapsible toggles.
    renderWithMantine(
      <ProtocolListPanel
        {...baseProps}
        entries={sampleEntries}
        pinnedIds={new Set(["req-1"])}
      />,
    );
    const header = screen.getByRole("button", { name: "History (2)" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  it("renders a lone unpinned section headerless, with its entries shown", () => {
    // Only the unpinned section → no header at all, no accordion toggle,
    // entries always visible.
    renderWithMantine(
      <ProtocolListPanel {...baseProps} entries={sampleEntries} />,
    );
    expect(screen.queryByText("History (3)")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "History (3)" }),
    ).not.toBeInTheDocument();
    // An entry's method badge is visible (content shown, not collapsed).
    expect(screen.getByText("resources/read")).toBeInTheDocument();
  });

  it("shows the surviving section's entries after the other is removed, even if it was collapsed", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithMantine(
      <ProtocolListPanel
        {...baseProps}
        entries={sampleEntries}
        pinnedIds={new Set(["req-1"])}
      />,
    );
    // Collapse the History section while both sections are present.
    await user.click(screen.getByRole("button", { name: "History (2)" }));
    expect(screen.getByRole("button", { name: "History (2)" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // Remove the pinned section → History is now the only section. Its entries
    // must show despite the stale collapsed state, and the header is plain.
    rerender(<ProtocolListPanel {...baseProps} entries={sampleEntries} />);
    expect(
      screen.queryByRole("button", { name: "History (3)" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("resources/read")).toBeInTheDocument();
  });

  it("collapses the Pinned and History sections independently", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ProtocolListPanel
        {...baseProps}
        entries={sampleEntries}
        pinnedIds={new Set(["req-1"])}
      />,
    );
    const pinned = screen.getByRole("button", {
      name: "Pinned Messages (1)",
    });
    const history = screen.getByRole("button", { name: "History (2)" });
    await user.click(pinned);
    expect(pinned).toHaveAttribute("aria-expanded", "false");
    // Collapsing Pinned leaves History untouched.
    expect(history).toHaveAttribute("aria-expanded", "true");
  });

  it("shows per-section Clear/Export only when both sections are present", () => {
    // Only an unpinned section → just the panel-level Clear/Export.
    const { unmount } = renderWithMantine(
      <ProtocolListPanel {...baseProps} entries={sampleEntries} />,
    );
    expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Export" })).toHaveLength(1);
    unmount();

    // Both sections → panel-level plus one Clear/Export per section.
    renderWithMantine(
      <ProtocolListPanel
        {...baseProps}
        entries={sampleEntries}
        pinnedIds={new Set(["req-1"])}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Export" })).toHaveLength(3);
  });

  it("invokes onClearSection/onExportSection for the clicked section", async () => {
    const user = userEvent.setup();
    const onClearSection = vi.fn();
    const onExportSection = vi.fn();
    renderWithMantine(
      <ProtocolListPanel
        {...baseProps}
        entries={sampleEntries}
        pinnedIds={new Set(["req-1"])}
        onClearSection={onClearSection}
        onExportSection={onExportSection}
      />,
    );
    // [0] = panel-level, [1] = Pinned section, [2] = History section.
    const clears = screen.getAllByRole("button", { name: "Clear" });
    const exports = screen.getAllByRole("button", { name: "Export" });
    await user.click(clears[1]);
    expect(onClearSection).toHaveBeenCalledWith("pinned");
    await user.click(exports[2]);
    expect(onExportSection).toHaveBeenCalledWith("history");
  });

  it("hides entries whose message direction is toggled off", () => {
    const directional: MessageEntry[] = [
      { ...sampleEntries[0], id: "from-client", origin: "client" },
      { ...sampleEntries[1], id: "from-server", origin: "server" },
    ];
    renderWithMantine(
      <ProtocolListPanel
        {...baseProps}
        entries={directional}
        visibleDirections={{ client: true, server: false }}
      />,
    );
    // The server-origin entry is filtered out, leaving the client one.
    expect(screen.getByText("tools/call")).toBeInTheDocument();
    expect(screen.queryByText("resources/read")).toBeNull();
  });

  it("filters entries by searchText (case-insensitive)", () => {
    renderWithMantine(
      <ProtocolListPanel
        {...baseProps}
        entries={sampleEntries}
        searchText="config.json"
      />,
    );
    // Only the resources/read entry references config.json.
    expect(screen.getByText("resources/read")).toBeInTheDocument();
    expect(screen.queryByText("tools/call")).toBeNull();
    expect(screen.queryByText("tools/list")).toBeNull();
  });

  it("filters entries by methodFilter", () => {
    renderWithMantine(
      <ProtocolListPanel
        {...baseProps}
        entries={sampleEntries}
        methodFilter="tools/list"
      />,
    );
    expect(screen.getByText("tools/list")).toBeInTheDocument();
    expect(screen.queryByText("tools/call")).toBeNull();
    expect(screen.queryByText("resources/read")).toBeNull();
  });

  it("invokes onExport when Export is clicked", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    renderWithMantine(
      <ProtocolListPanel
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
      <ProtocolListPanel
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
      <ProtocolListPanel
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
      <ProtocolListPanel
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
      <ProtocolListPanel
        {...baseProps}
        entries={[sampleEntries[0]]}
        pinnedIds={new Set(["req-1"])}
      />,
    );
    expect(screen.getByText("Pinned Messages (1)")).toBeInTheDocument();
    expect(screen.queryByText(/^History \(/)).not.toBeInTheDocument();
  });

  it("invokes onReplay and onTogglePin from the pinned section", async () => {
    const user = userEvent.setup();
    const onReplay = vi.fn();
    const onTogglePin = vi.fn();
    renderWithMantine(
      <ProtocolListPanel
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
      <ProtocolListPanel {...baseProps} entries={sampleEntries} />,
    );
    const methods = screen.getAllByText(
      /tools\/call|resources\/read|tools\/list/,
    );
    expect(methods[0]).toHaveTextContent("tools/list");
    expect(methods[methods.length - 1]).toHaveTextContent("tools/call");
  });

  it("reorders entries when sortDirection is oldest-first", () => {
    renderWithMantine(
      <ProtocolListPanel
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
      <ProtocolListPanel
        {...baseProps}
        entries={sampleEntries}
        onSortChange={onSortChange}
      />,
    );
    await user.click(
      screen.getByRole("textbox", { name: "History sort direction" }),
    );
    await user.click(await screen.findByText("Oldest First"));
    expect(onSortChange).toHaveBeenCalledWith("oldest-first");
  });

  it("renders entries collapsed when compact is true (default parity with Network)", () => {
    renderWithMantine(
      <ProtocolListPanel {...baseProps} entries={sampleEntries} compact />,
    );
    expect(
      screen.getAllByRole("button", { name: "Expand" }).length,
    ).toBeGreaterThan(0);
  });

  it("renders entries expanded when compact is false", () => {
    renderWithMantine(
      <ProtocolListPanel
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
      <ProtocolListPanel
        {...baseProps}
        entries={sampleEntries}
        onToggleCompact={onToggleCompact}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(onToggleCompact).toHaveBeenCalledTimes(1);
  });

  it("shows an era badge when a protocol era is provided", () => {
    renderWithMantine(
      <ProtocolListPanel
        {...baseProps}
        entries={sampleEntries}
        protocolEra="modern"
      />,
    );
    expect(screen.getByText("Modern")).toBeInTheDocument();
  });

  it("omits the era badge when no era is provided", () => {
    renderWithMantine(
      <ProtocolListPanel {...baseProps} entries={sampleEntries} />,
    );
    expect(screen.queryByText("Modern")).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy")).not.toBeInTheDocument();
  });

  it("groups contiguous MRTR rounds into one expandable conversation", () => {
    const original: MessageEntry = {
      id: "mrtr-orig",
      timestamp: new Date("2026-07-28T10:00:00Z"),
      direction: "request",
      origin: "client",
      message: {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "book_flight" },
      },
      response: {
        jsonrpc: "2.0",
        id: 10,
        result: { resultType: "input_required", requestState: "tok" },
      },
    };
    const retry: MessageEntry = {
      id: "mrtr-retry",
      timestamp: new Date("2026-07-28T10:00:05Z"),
      direction: "request",
      origin: "client",
      message: {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "book_flight", requestState: "tok" },
      },
      response: {
        jsonrpc: "2.0",
        id: 11,
        result: { resultType: "complete", content: [] },
      },
    };
    renderWithMantine(
      <ProtocolListPanel
        {...baseProps}
        entries={[original, retry]}
        compact={false}
      />,
    );
    // One MRTR conversation wrapper labeling the two rounds as a unit.
    expect(screen.getByText("MRTR")).toBeInTheDocument();
    expect(screen.getByText("2 rounds")).toBeInTheDocument();
    expect(screen.getByTestId("mrtr-status")).toHaveTextContent("Complete");
  });
});
