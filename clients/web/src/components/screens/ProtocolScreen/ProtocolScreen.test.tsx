import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ProtocolScreen } from "./ProtocolScreen";
import { EMPTY_PROTOCOL_UI } from "../screenUiState";

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
  ui: EMPTY_PROTOCOL_UI,
  onUiChange: vi.fn(),
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

describe("ProtocolScreen", () => {
  it("renders the controls and panel", () => {
    renderWithMantine(<ProtocolScreen {...baseProps} />);
    expect(screen.getByText("Protocol")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  it("renders empty state when there are no entries", () => {
    renderWithMantine(<ProtocolScreen {...baseProps} entries={[]} />);
    expect(screen.getByText("Protocol")).toBeInTheDocument();
  });

  it("invokes onClearAll when clear is triggered", async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    renderWithMantine(
      <ProtocolScreen {...baseProps} onClearAll={onClearAll} />,
    );
    const clearButton = screen.getByRole("button", { name: /Clear/ });
    await user.click(clearButton);
    expect(onClearAll).toHaveBeenCalled();
  });

  it("emits the search text through onUiChange", async () => {
    const user = userEvent.setup();
    const onUiChange = vi.fn();
    renderWithMantine(
      <ProtocolScreen {...baseProps} onUiChange={onUiChange} />,
    );
    await user.type(screen.getByPlaceholderText("Search..."), "t");
    expect(onUiChange).toHaveBeenCalledWith(
      expect.objectContaining({ search: "t" }),
    );
  });

  it("toggles a single message direction through onUiChange", async () => {
    const user = userEvent.setup();
    const onUiChange = vi.fn();
    renderWithMantine(
      <ProtocolScreen {...baseProps} onUiChange={onUiChange} />,
    );
    await user.click(screen.getByRole("button", { name: "client ← server" }));
    expect(onUiChange).toHaveBeenCalledWith(
      expect.objectContaining({
        visibleDirections: { client: true, server: false },
      }),
    );
  });

  it("toggles all message directions off through onUiChange", async () => {
    const user = userEvent.setup();
    const onUiChange = vi.fn();
    renderWithMantine(
      <ProtocolScreen {...baseProps} onUiChange={onUiChange} />,
    );
    await user.click(screen.getByRole("button", { name: "Deselect All" }));
    expect(onUiChange).toHaveBeenCalledWith(
      expect.objectContaining({
        visibleDirections: { client: false, server: false },
      }),
    );
  });

  it("emits the cleared method filter through onUiChange", async () => {
    const user = userEvent.setup();
    const onUiChange = vi.fn();
    const { container } = renderWithMantine(
      <ProtocolScreen
        {...baseProps}
        ui={{ ...EMPTY_PROTOCOL_UI, methodFilter: "tools/list" }}
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

  it("renders a pin-as-column button when onPin is provided and invokes it", async () => {
    const user = userEvent.setup();
    const onPin = vi.fn();
    renderWithMantine(<ProtocolScreen {...baseProps} onPin={onPin} />);
    await user.click(screen.getByRole("button", { name: "Pin as column" }));
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  it("drops the filter sidebar when embedded, keeping the request list", () => {
    renderWithMantine(<ProtocolScreen {...baseProps} embedded />);
    expect(screen.getByText("Requests")).toBeInTheDocument();
    // The sidebar (ProtocolControls, with its Search box) is not rendered.
    expect(screen.queryByPlaceholderText("Search...")).toBeNull();
  });

  it("applies the search text but ignores the method filter when embedded", () => {
    renderWithMantine(
      <ProtocolScreen
        {...baseProps}
        ui={{
          ...EMPTY_PROTOCOL_UI,
          // Method filter would exclude the tools/list entries on the full-size
          // screen...
          methodFilter: "resources/list",
          // ...but the column search matches them.
          search: "tools",
        }}
        embedded
      />,
    );
    expect(screen.queryByText("No request history")).toBeNull();
  });

  it("hides entries not matching the column search when embedded", () => {
    renderWithMantine(
      <ProtocolScreen
        {...baseProps}
        ui={{ ...EMPTY_PROTOCOL_UI, search: "zzz-no-match" }}
        embedded
      />,
    );
    expect(screen.getByText("No request history")).toBeInTheDocument();
  });
});
