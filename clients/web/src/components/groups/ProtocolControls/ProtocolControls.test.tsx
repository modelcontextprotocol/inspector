import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { MessageMethod } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ProtocolControls } from "./ProtocolControls";

const baseProps = {
  searchText: "",
  availableMethods: ["tools/list", "prompts/list"] as MessageMethod[],
  visibleDirections: { client: true, server: true },
  onSearchChange: vi.fn(),
  onMethodFilterChange: vi.fn(),
  onToggleDirection: vi.fn(),
  onToggleAllDirections: vi.fn(),
};

describe("ProtocolControls", () => {
  it("renders the title and search input", () => {
    renderWithMantine(<ProtocolControls {...baseProps} />);
    expect(screen.getByText("Protocol")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  it("invokes onSearchChange when typing in the search input", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderWithMantine(
      <ProtocolControls {...baseProps} onSearchChange={onSearchChange} />,
    );
    await user.type(screen.getByPlaceholderText("Search..."), "a");
    expect(onSearchChange).toHaveBeenCalledWith("a");
  });

  it("clears the search input when the Clear button is clicked", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderWithMantine(
      <ProtocolControls
        {...baseProps}
        searchText="abc"
        onSearchChange={onSearchChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("keeps the search Clear button out of the keyboard tab order", () => {
    renderWithMantine(<ProtocolControls {...baseProps} searchText="abc" />);
    expect(screen.getByRole("button", { name: "Clear" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("renders the method filter placeholder", () => {
    renderWithMantine(<ProtocolControls {...baseProps} />);
    expect(screen.getByPlaceholderText("All methods")).toBeInTheDocument();
  });

  it("displays the active method filter value", () => {
    renderWithMantine(
      <ProtocolControls {...baseProps} methodFilter="tools/list" />,
    );
    const inputs = screen.getAllByDisplayValue("tools/list");
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("invokes onMethodFilterChange with undefined when cleared", async () => {
    const user = userEvent.setup();
    const onMethodFilterChange = vi.fn();
    const { container } = renderWithMantine(
      <ProtocolControls
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

  it("renders the Filter by Message Direction section with both directions", () => {
    renderWithMantine(<ProtocolControls {...baseProps} />);
    expect(screen.getByText("Filter by Message Direction")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "client → server" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "client ← server" }),
    ).toBeInTheDocument();
  });

  it("toggles a direction's visibility when its button is clicked", async () => {
    const user = userEvent.setup();
    const onToggleDirection = vi.fn();
    renderWithMantine(
      <ProtocolControls {...baseProps} onToggleDirection={onToggleDirection} />,
    );
    // Currently visible → clicking turns it off.
    await user.click(screen.getByRole("button", { name: "client ← server" }));
    expect(onToggleDirection).toHaveBeenCalledWith("server", false);
  });

  it("invokes onToggleAllDirections from the Deselect/Select All control", async () => {
    const user = userEvent.setup();
    const onToggleAllDirections = vi.fn();
    renderWithMantine(
      <ProtocolControls
        {...baseProps}
        onToggleAllDirections={onToggleAllDirections}
      />,
    );
    // Both visible → the control reads "Deselect All".
    await user.click(screen.getByRole("button", { name: "Deselect All" }));
    expect(onToggleAllDirections).toHaveBeenCalledTimes(1);
  });
});
