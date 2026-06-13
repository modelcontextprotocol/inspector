import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { FilterToggleButton } from "./FilterToggleButton";

const baseProps = {
  label: "debug",
  color: "blue",
  active: false,
  onToggle: vi.fn(),
};

describe("FilterToggleButton", () => {
  it("renders the label as the accessible name", () => {
    renderWithMantine(<FilterToggleButton {...baseProps} />);
    expect(screen.getByRole("button", { name: "debug" })).toBeInTheDocument();
  });

  it("reflects the active state via aria-pressed=true", () => {
    renderWithMantine(<FilterToggleButton {...baseProps} active={true} />);
    expect(screen.getByRole("button", { name: "debug" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reflects the inactive state via aria-pressed=false", () => {
    renderWithMantine(<FilterToggleButton {...baseProps} active={false} />);
    expect(screen.getByRole("button", { name: "debug" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("toggles to true when an inactive button is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithMantine(
      <FilterToggleButton {...baseProps} active={false} onToggle={onToggle} />,
    );
    await user.click(screen.getByRole("button", { name: "debug" }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("toggles to false when an active button is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithMantine(
      <FilterToggleButton {...baseProps} active={true} onToggle={onToggle} />,
    );
    await user.click(screen.getByRole("button", { name: "debug" }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
