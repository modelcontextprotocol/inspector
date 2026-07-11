import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { MonitoringToggle } from "./MonitoringToggle";

describe("MonitoringToggle", () => {
  it("renders an open-column button when closed", () => {
    renderWithMantine(<MonitoringToggle open={false} onToggle={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Open monitoring column" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close monitoring column" }),
    ).toBeNull();
  });

  it("renders a close-column button when open", () => {
    renderWithMantine(<MonitoringToggle open onToggle={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Close monitoring column" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open monitoring column" }),
    ).toBeNull();
  });

  it("invokes onToggle when clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithMantine(<MonitoringToggle open={false} onToggle={onToggle} />);
    await user.click(
      screen.getByRole("button", { name: "Open monitoring column" }),
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
