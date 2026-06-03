import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { HistoryScreen } from "./HistoryScreen";
import { EMPTY_HISTORY_UI } from "../screenUiState";

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
  ui: EMPTY_HISTORY_UI,
  onUiChange: vi.fn(),
  onClearAll: vi.fn(),
  onExport: vi.fn(),
  onReplay: vi.fn(),
  onTogglePin: vi.fn(),
  sortDirection: "newest-first" as const,
  onSortChange: vi.fn(),
  compact: true,
  onToggleCompact: vi.fn(),
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

  it("emits the search text through onUiChange", async () => {
    const user = userEvent.setup();
    const onUiChange = vi.fn();
    renderWithMantine(<HistoryScreen {...baseProps} onUiChange={onUiChange} />);
    await user.type(screen.getByPlaceholderText("Search..."), "t");
    expect(onUiChange).toHaveBeenCalledWith(
      expect.objectContaining({ search: "t" }),
    );
  });

  it("emits the cleared method filter through onUiChange", async () => {
    const user = userEvent.setup();
    const onUiChange = vi.fn();
    const { container } = renderWithMantine(
      <HistoryScreen
        {...baseProps}
        ui={{ ...EMPTY_HISTORY_UI, methodFilter: "tools/list" }}
        onUiChange={onUiChange}
      />,
    );
    const clearButton = container.querySelector(
      "button.mantine-InputClearButton-root",
    ) as HTMLButtonElement | null;
    expect(clearButton).not.toBeNull();
    await user.click(clearButton!);
    expect(onUiChange).toHaveBeenCalledWith(
      expect.objectContaining({ methodFilter: undefined }),
    );
  });
});
