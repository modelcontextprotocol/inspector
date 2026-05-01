import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { TaskControls } from "./TaskControls";

const baseProps = {
  searchText: "",
  onSearchChange: vi.fn(),
  onStatusFilterChange: vi.fn(),
  onRefresh: vi.fn(),
};

describe("TaskControls", () => {
  it("renders the title and refresh button", () => {
    renderWithMantine(<TaskControls {...baseProps} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("invokes onRefresh when Refresh is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    renderWithMantine(<TaskControls {...baseProps} onRefresh={onRefresh} />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("invokes onSearchChange when typing", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderWithMantine(
      <TaskControls {...baseProps} onSearchChange={onSearchChange} />,
    );
    await user.type(screen.getByPlaceholderText("Search..."), "x");
    expect(onSearchChange).toHaveBeenCalledWith("x");
  });

  it("displays the active status filter", () => {
    renderWithMantine(<TaskControls {...baseProps} statusFilter="working" />);
    const inputs = screen.getAllByDisplayValue("working");
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("invokes onStatusFilterChange with undefined when cleared", async () => {
    const user = userEvent.setup();
    const onStatusFilterChange = vi.fn();
    const { container } = renderWithMantine(
      <TaskControls
        {...baseProps}
        statusFilter="working"
        onStatusFilterChange={onStatusFilterChange}
      />,
    );
    const clearButton = container.querySelector(
      "button.mantine-InputClearButton-root",
    ) as HTMLButtonElement | null;
    expect(clearButton).not.toBeNull();
    await user.click(clearButton!);
    expect(onStatusFilterChange).toHaveBeenCalledWith(undefined);
  });
});
