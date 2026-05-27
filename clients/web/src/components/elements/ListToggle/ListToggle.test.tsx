import { describe, it, expect, vi } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import userEvent from "@testing-library/user-event";
import { ListToggle } from "./ListToggle";

describe("ListToggle", () => {
  it("renders a Button by default with 'Expand all' aria-label when compact", () => {
    renderWithMantine(<ListToggle compact onToggle={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Expand all" }),
    ).toBeInTheDocument();
  });

  it("renders 'Collapse all' aria-label when not compact", () => {
    renderWithMantine(<ListToggle compact={false} onToggle={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Collapse all" }),
    ).toBeInTheDocument();
  });

  it("renders an ActionIcon for the subtle variant and labels it", () => {
    renderWithMantine(
      <ListToggle compact variant="subtle" onToggle={() => {}} />,
    );
    expect(
      screen.getByRole("button", { name: "Expand all" }),
    ).toBeInTheDocument();
  });

  it("invokes onToggle when clicked (default variant)", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithMantine(<ListToggle compact onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("invokes onToggle when clicked (subtle variant)", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithMantine(
      <ListToggle compact={false} variant="subtle" onToggle={onToggle} />,
    );
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
