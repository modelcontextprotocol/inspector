import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ClearButton } from "./ClearButton";

describe("ClearButton", () => {
  it('renders with the "Clear" accessible name', () => {
    renderWithMantine(<ClearButton />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("is removed from the keyboard tab order", () => {
    renderWithMantine(<ClearButton />);
    expect(screen.getByRole("button", { name: "Clear" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("invokes onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithMantine(<ClearButton onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("allows the accessible name to be overridden", () => {
    renderWithMantine(<ClearButton aria-label="Clear search" />);
    expect(
      screen.getByRole("button", { name: "Clear search" }),
    ).toBeInTheDocument();
  });
});
