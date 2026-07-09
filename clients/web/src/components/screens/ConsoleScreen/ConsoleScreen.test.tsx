import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { StderrLogEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ConsoleScreen, type ConsoleScreenProps } from "./ConsoleScreen";
import { EMPTY_CONSOLE_UI } from "../screenUiState";

const entries: StderrLogEntry[] = [
  { timestamp: new Date("2026-03-17T10:00:00Z"), message: "first line" },
  { timestamp: new Date("2026-03-17T10:00:01Z"), message: "second BOOM line" },
];

function makeProps(
  overrides: Partial<ConsoleScreenProps> = {},
): ConsoleScreenProps {
  return {
    entries,
    ui: EMPTY_CONSOLE_UI,
    onUiChange: vi.fn(),
    onClear: vi.fn(),
    onExport: vi.fn(),
    sortDirection: "newest-first",
    onSortChange: vi.fn(),
    ...overrides,
  };
}

describe("ConsoleScreen", () => {
  it("renders each stderr entry's message", () => {
    renderWithMantine(<ConsoleScreen {...makeProps()} />);
    expect(screen.getByText("first line")).toBeInTheDocument();
    expect(screen.getByText("second BOOM line")).toBeInTheDocument();
  });

  it("shows the empty state when there are no entries", () => {
    renderWithMantine(<ConsoleScreen {...makeProps({ entries: [] })} />);
    expect(screen.getByText("No console output")).toBeInTheDocument();
  });

  it("filters entries by the search text in ui", () => {
    renderWithMantine(
      <ConsoleScreen {...makeProps({ ui: { filterText: "boom" } })} />,
    );
    expect(screen.queryByText("first line")).toBeNull();
    expect(screen.getByText("second BOOM line")).toBeInTheDocument();
  });

  it("dispatches onUiChange when typing in the search box", async () => {
    const onUiChange = vi.fn();
    const user = userEvent.setup();
    renderWithMantine(<ConsoleScreen {...makeProps({ onUiChange })} />);
    await user.type(screen.getByPlaceholderText("Search..."), "x");
    expect(onUiChange).toHaveBeenCalledWith({ filterText: "x" });
  });

  it("clears the search text via the clear button", async () => {
    const onUiChange = vi.fn();
    const user = userEvent.setup();
    renderWithMantine(
      <ConsoleScreen
        {...makeProps({ ui: { filterText: "boom" }, onUiChange })}
      />,
    );
    // Two controls share the accessible name "Clear": the search-box clear
    // ActionIcon (rendered first, in the sidebar) and the panel's Clear button.
    // The sidebar one is the search reset.
    const [clearSearch] = screen.getAllByRole("button", { name: "Clear" });
    await user.click(clearSearch);
    expect(onUiChange).toHaveBeenCalledWith({ filterText: "" });
  });

  it("orders entries oldest-first when requested", () => {
    renderWithMantine(
      <ConsoleScreen {...makeProps({ sortDirection: "oldest-first" })} />,
    );
    const rendered = screen.getAllByText(/line$/);
    expect(rendered[0]).toHaveTextContent("first line");
  });

  it("orders entries newest-first by default", () => {
    renderWithMantine(<ConsoleScreen {...makeProps()} />);
    const rendered = screen.getAllByText(/line$/);
    expect(rendered[0]).toHaveTextContent("second BOOM line");
  });

  it("disables Clear and Export when there are no entries", () => {
    renderWithMantine(<ConsoleScreen {...makeProps({ entries: [] })} />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("invokes onClear and onExport", async () => {
    const onClear = vi.fn();
    const onExport = vi.fn();
    const user = userEvent.setup();
    renderWithMantine(<ConsoleScreen {...makeProps({ onClear, onExport })} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledOnce();
  });

  it("shows a pin button only when onPin is provided", () => {
    const { rerender } = renderWithMantine(<ConsoleScreen {...makeProps()} />);
    expect(screen.queryByRole("button", { name: "Pin as column" })).toBeNull();
    rerender(<ConsoleScreen {...makeProps({ onPin: vi.fn() })} />);
    expect(
      screen.getByRole("button", { name: "Pin as column" }),
    ).toBeInTheDocument();
  });

  it("drops the search sidebar when embedded", () => {
    renderWithMantine(<ConsoleScreen {...makeProps({ embedded: true })} />);
    // The embedded column has no in-screen search box (the column supplies it).
    expect(screen.queryByPlaceholderText("Search...")).toBeNull();
    // Entries still render.
    expect(screen.getByText("first line")).toBeInTheDocument();
  });
});
