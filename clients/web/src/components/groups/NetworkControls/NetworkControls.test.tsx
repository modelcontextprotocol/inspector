import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { NetworkControls } from "./NetworkControls";

const baseProps = {
  filterText: "",
  visibleCategories: { auth: true, transport: true } as const,
  onFilterChange: vi.fn(),
  onToggleCategory: vi.fn(),
  onToggleAllCategories: vi.fn(),
};

describe("NetworkControls", () => {
  it("renders the title and inputs", () => {
    renderWithMantine(<NetworkControls {...baseProps} />);
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "auth" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "transport" }),
    ).toBeInTheDocument();
  });

  it("fires onFilterChange when the user types", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    renderWithMantine(
      <NetworkControls {...baseProps} onFilterChange={onFilterChange} />,
    );
    await user.type(screen.getByPlaceholderText("Search..."), "x");
    expect(onFilterChange).toHaveBeenLastCalledWith("x");
  });

  it("reflects category visibility via aria-pressed", () => {
    renderWithMantine(
      <NetworkControls
        {...baseProps}
        visibleCategories={{ auth: true, transport: false }}
      />,
    );
    expect(screen.getByRole("button", { name: "auth" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "transport" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("fires onToggleCategory with inverted visibility when clicked", async () => {
    const user = userEvent.setup();
    const onToggleCategory = vi.fn();
    renderWithMantine(
      <NetworkControls {...baseProps} onToggleCategory={onToggleCategory} />,
    );
    await user.click(screen.getByRole("button", { name: "auth" }));
    expect(onToggleCategory).toHaveBeenCalledWith("auth", false);
  });

  it("toggles between Select All and Deselect All", () => {
    const { rerender } = renderWithMantine(<NetworkControls {...baseProps} />);
    expect(
      screen.getByRole("button", { name: "Deselect All" }),
    ).toBeInTheDocument();
    rerender(
      <NetworkControls
        {...baseProps}
        visibleCategories={{ auth: false, transport: false }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Select All" }),
    ).toBeInTheDocument();
  });

  it("fires onToggleAllCategories when the toggle button is clicked", async () => {
    const user = userEvent.setup();
    const onToggleAllCategories = vi.fn();
    renderWithMantine(
      <NetworkControls
        {...baseProps}
        onToggleAllCategories={onToggleAllCategories}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Deselect All" }));
    expect(onToggleAllCategories).toHaveBeenCalledTimes(1);
  });
});
