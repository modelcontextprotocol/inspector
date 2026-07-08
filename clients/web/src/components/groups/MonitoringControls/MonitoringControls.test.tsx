import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { MonitoringControls } from "./MonitoringControls";

const TABS = ["Logs", "History", "Network"];

describe("MonitoringControls", () => {
  it("renders a radio option for each available tab", () => {
    renderWithMantine(
      <MonitoringControls
        tabs={TABS}
        value="Logs"
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    for (const tab of TABS) {
      expect(screen.getByRole("radio", { name: tab })).toBeInTheDocument();
    }
  });

  it("renders only the tabs it is given", () => {
    renderWithMantine(
      <MonitoringControls
        tabs={["Logs", "History"]}
        value="Logs"
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByRole("radio", { name: "Network" })).toBeNull();
  });

  it("gives the tab switcher an accessible name", () => {
    const { container } = renderWithMantine(
      <MonitoringControls
        tabs={TABS}
        value="Logs"
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[aria-label="Monitoring screen"]'),
    ).not.toBeNull();
  });

  it("marks the active tab as selected", () => {
    renderWithMantine(
      <MonitoringControls
        tabs={TABS}
        value="History"
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("radio", { name: "History" })).toBeChecked();
  });

  it("calls onChange when a different tab is chosen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithMantine(
      <MonitoringControls
        tabs={TABS}
        value="Logs"
        onChange={onChange}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Network" }));
    expect(onChange).toHaveBeenCalledWith("Network");
  });

  it("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithMantine(
      <MonitoringControls
        tabs={TABS}
        value="Logs"
        onChange={vi.fn()}
        onClose={onClose}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Close monitoring column" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
