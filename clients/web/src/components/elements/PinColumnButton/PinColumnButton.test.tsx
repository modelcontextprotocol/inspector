import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { PinColumnButton } from "./PinColumnButton";

describe("PinColumnButton", () => {
  it("renders a labelled pin-as-column button", () => {
    renderWithMantine(<PinColumnButton onPin={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Pin as column" }),
    ).toBeInTheDocument();
  });

  it("invokes onPin when clicked", async () => {
    const user = userEvent.setup();
    const onPin = vi.fn();
    renderWithMantine(<PinColumnButton onPin={onPin} />);
    await user.click(screen.getByRole("button", { name: "Pin as column" }));
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  it("uses a custom accessible label when provided", () => {
    renderWithMantine(
      <PinColumnButton onPin={vi.fn()} label="Open monitoring column" />,
    );
    expect(
      screen.getByRole("button", { name: "Open monitoring column" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pin as column" })).toBeNull();
  });
});
