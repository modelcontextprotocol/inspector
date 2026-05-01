import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { HistoryScreen } from "./HistoryScreen";

const sampleEntries: MessageEntry[] = [
  {
    id: "1",
    timestamp: new Date(),
    direction: "request",
    message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  },
  {
    id: "2",
    timestamp: new Date(),
    direction: "response",
    message: { jsonrpc: "2.0", id: 1, result: {} },
  },
];

const baseProps = {
  entries: sampleEntries,
  pinnedIds: new Set<string>(),
  onClearAll: vi.fn(),
  onExport: vi.fn(),
  onReplay: vi.fn(),
  onTogglePin: vi.fn(),
};

describe("HistoryScreen", () => {
  it("renders the controls and panel", () => {
    renderWithMantine(<HistoryScreen {...baseProps} />);
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  it("renders empty state when there are no entries", () => {
    renderWithMantine(<HistoryScreen {...baseProps} entries={[]} />);
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("invokes onClearAll when clear is triggered", async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    renderWithMantine(<HistoryScreen {...baseProps} onClearAll={onClearAll} />);
    const clearButton = screen.getByRole("button", { name: /Clear/ });
    await user.click(clearButton);
    expect(onClearAll).toHaveBeenCalled();
  });
});
