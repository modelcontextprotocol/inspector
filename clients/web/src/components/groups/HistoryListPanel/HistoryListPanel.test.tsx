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
};

describe("HistoryListPanel", () => {
  it("renders the title and Export JSON button", () => {
    renderWithMantine(<HistoryListPanel {...baseProps} entries={[]} />);
    expect(screen.getByText("Requests")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export JSON" }),
    ).toBeInTheDocument();
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

  it("invokes onExport when Export JSON is clicked", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    renderWithMantine(
      <HistoryListPanel
        {...baseProps}
        entries={sampleEntries}
        onExport={onExport}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Export JSON" }));
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

  it("toggles compact list state when ListToggle is clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <HistoryListPanel {...baseProps} entries={sampleEntries} />,
    );
    // Initially expanded — Collapse buttons exist on each entry
    expect(
      screen.getAllByRole("button", { name: "Collapse" }).length,
    ).toBeGreaterThan(0);

    // Find the ListToggle button (last subtle toolbar button at top — has no accessible name)
    const buttons = screen.getAllByRole("button");
    const toggle = buttons.find(
      (b) =>
        b.textContent === "" && b.classList.contains("mantine-Button-root"),
    );
    expect(toggle).toBeDefined();
    await user.click(toggle!);

    // After toggle, entries collapsed — they show Expand
    expect(
      screen.getAllByRole("button", { name: "Expand" }).length,
    ).toBeGreaterThan(0);
  });
});
