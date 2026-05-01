import { describe, it, expect, vi } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import userEvent from "@testing-library/user-event";
import { ConnectionToggle } from "./ConnectionToggle";

describe("ConnectionToggle", () => {
  it("is unchecked when disconnected", () => {
    renderWithMantine(
      <ConnectionToggle status="disconnected" onToggle={() => {}} />,
    );
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("is checked when connected", () => {
    renderWithMantine(
      <ConnectionToggle status="connected" onToggle={() => {}} />,
    );
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("is checked but disabled while connecting", () => {
    renderWithMantine(
      <ConnectionToggle status="connecting" onToggle={() => {}} />,
    );
    const sw = screen.getByRole("switch");
    expect(sw).toBeChecked();
    expect(sw).toBeDisabled();
  });

  it("respects external disabled prop", () => {
    renderWithMantine(
      <ConnectionToggle status="disconnected" disabled onToggle={() => {}} />,
    );
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("invokes onToggle when clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithMantine(
      <ConnectionToggle status="disconnected" onToggle={onToggle} />,
    );
    await user.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
