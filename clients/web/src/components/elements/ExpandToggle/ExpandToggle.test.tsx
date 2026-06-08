import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ExpandToggle } from "./ExpandToggle";

describe("ExpandToggle", () => {
  it("labels itself Expand when collapsed", () => {
    renderWithMantine(<ExpandToggle expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
  });

  it("labels itself Collapse when expanded", () => {
    renderWithMantine(<ExpandToggle expanded={true} onToggle={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("invokes onToggle when clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithMantine(<ExpandToggle expanded={false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
