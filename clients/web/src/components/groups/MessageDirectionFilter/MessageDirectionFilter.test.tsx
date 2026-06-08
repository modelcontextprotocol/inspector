import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { MessageDirectionFilter } from "./MessageDirectionFilter";

const baseProps = {
  visibleDirections: { client: true, server: true },
  onToggleDirection: vi.fn(),
  onToggleAllDirections: vi.fn(),
};

describe("MessageDirectionFilter", () => {
  it("renders the heading and both direction toggles", () => {
    renderWithMantine(<MessageDirectionFilter {...baseProps} />);
    expect(screen.getByText("Filter by Message Direction")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "client → server" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "client ← server" }),
    ).toBeInTheDocument();
  });

  it("toggles a direction off when it's currently visible", async () => {
    const user = userEvent.setup();
    const onToggleDirection = vi.fn();
    renderWithMantine(
      <MessageDirectionFilter
        {...baseProps}
        onToggleDirection={onToggleDirection}
      />,
    );
    await user.click(screen.getByRole("button", { name: "client ← server" }));
    expect(onToggleDirection).toHaveBeenCalledWith("server", false);
  });

  it("shows Deselect All when all visible and invokes onToggleAllDirections", async () => {
    const user = userEvent.setup();
    const onToggleAllDirections = vi.fn();
    renderWithMantine(
      <MessageDirectionFilter
        {...baseProps}
        onToggleAllDirections={onToggleAllDirections}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Deselect All" }));
    expect(onToggleAllDirections).toHaveBeenCalledTimes(1);
  });

  it("shows Select All when not all directions are visible", () => {
    renderWithMantine(
      <MessageDirectionFilter
        {...baseProps}
        visibleDirections={{ client: true, server: false }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Select All" }),
    ).toBeInTheDocument();
  });
});
