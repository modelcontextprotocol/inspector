import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { MessageMethod } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { HistoryControls } from "./HistoryControls";

const baseProps = {
  searchText: "",
  availableMethods: ["tools/list", "prompts/list"] as MessageMethod[],
  onSearchChange: vi.fn(),
  onMethodFilterChange: vi.fn(),
};

describe("HistoryControls", () => {
  it("renders the title and search input", () => {
    renderWithMantine(<HistoryControls {...baseProps} />);
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  it("invokes onSearchChange when typing in the search input", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderWithMantine(
      <HistoryControls {...baseProps} onSearchChange={onSearchChange} />,
    );
    await user.type(screen.getByPlaceholderText("Search..."), "a");
    expect(onSearchChange).toHaveBeenCalledWith("a");
  });

  it("renders the method filter placeholder", () => {
    renderWithMantine(<HistoryControls {...baseProps} />);
    expect(screen.getByPlaceholderText("All methods")).toBeInTheDocument();
  });

  it("displays the active method filter value", () => {
    renderWithMantine(
      <HistoryControls {...baseProps} methodFilter="tools/list" />,
    );
    const inputs = screen.getAllByDisplayValue("tools/list");
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("invokes onMethodFilterChange with undefined when cleared", async () => {
    const user = userEvent.setup();
    const onMethodFilterChange = vi.fn();
    const { container } = renderWithMantine(
      <HistoryControls
        {...baseProps}
        methodFilter="tools/list"
        onMethodFilterChange={onMethodFilterChange}
      />,
    );
    const clearButton = container.querySelector(
      "button.mantine-InputClearButton-root",
    ) as HTMLButtonElement | null;
    expect(clearButton).not.toBeNull();
    await user.click(clearButton!);
    expect(onMethodFilterChange).toHaveBeenCalledWith(undefined);
  });
});
