import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { EnlargeButton } from "./EnlargeButton";

describe("EnlargeButton", () => {
  it('renders with the "Enlarge" accessible name', () => {
    renderWithMantine(<EnlargeButton onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Enlarge" })).toBeInTheDocument();
  });

  // Out of the tab order like ClearButton (#2138) — a form's string fields each
  // carry one, so leaving them in doubled the stops between adjacent fields.
  it("is out of the keyboard tab order", () => {
    renderWithMantine(<EnlargeButton onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Enlarge" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  // The property that matters is skipped-by-Tab, not the attribute that
  // implements it — asserted by driving a real Tab past a neighbouring input.
  it("is skipped when tabbing through the surrounding form", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <>
        <input aria-label="Before" />
        <EnlargeButton onClick={vi.fn()} />
        <input aria-label="After" />
      </>,
    );

    screen.getByRole("textbox", { name: "Before" }).focus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "After" })).toHaveFocus();
  });

  it("invokes onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithMantine(<EnlargeButton onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "Enlarge" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("allows the accessible name to be overridden", () => {
    renderWithMantine(
      <EnlargeButton onClick={vi.fn()} ariaLabel="Enlarge Query" />,
    );
    expect(
      screen.getByRole("button", { name: "Enlarge Query" }),
    ).toBeInTheDocument();
  });

  it("is inert when the field it belongs to is disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithMantine(<EnlargeButton onClick={onClick} disabled />);
    const button = screen.getByRole("button", { name: "Enlarge" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
