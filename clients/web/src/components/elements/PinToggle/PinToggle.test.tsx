import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { PinToggle } from "./PinToggle";

describe("PinToggle", () => {
  it("labels itself Pin when not pinned", () => {
    renderWithMantine(<PinToggle pinned={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  });

  it("labels itself Unpin when pinned", () => {
    renderWithMantine(<PinToggle pinned={true} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
  });

  it("invokes onToggle when clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithMantine(<PinToggle pinned={false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: "Pin" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
