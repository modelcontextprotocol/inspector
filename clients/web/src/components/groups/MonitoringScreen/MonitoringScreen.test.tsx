import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { MonitoringScreen } from "./MonitoringScreen";

const TABS = ["Logs", "History", "Network"];

function screens() {
  return {
    Logs: <div>logs-body</div>,
    History: <div>history-body</div>,
    Network: <div>network-body</div>,
  };
}

describe("MonitoringScreen", () => {
  it("renders the screen for the active tab", () => {
    renderWithMantine(
      <MonitoringScreen
        tabs={TABS}
        value="History"
        onChange={vi.fn()}
        onClose={vi.fn()}
        screens={screens()}
      />,
    );
    expect(screen.getByText("history-body")).toBeInTheDocument();
    expect(screen.queryByText("logs-body")).toBeNull();
    expect(screen.queryByText("network-body")).toBeNull();
  });

  it("renders the controls tab row", () => {
    renderWithMantine(
      <MonitoringScreen
        tabs={TABS}
        value="Logs"
        onChange={vi.fn()}
        onClose={vi.fn()}
        screens={screens()}
      />,
    );
    expect(screen.getByRole("radio", { name: "Logs" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close monitoring column" }),
    ).toBeInTheDocument();
  });

  it("forwards tab changes and close from the controls", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClose = vi.fn();
    renderWithMantine(
      <MonitoringScreen
        tabs={TABS}
        value="Logs"
        onChange={onChange}
        onClose={onClose}
        screens={screens()}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Network" }));
    expect(onChange).toHaveBeenCalledWith("Network");
    await user.click(
      screen.getByRole("button", { name: "Close monitoring column" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing in the slot when the active tab has no screen", () => {
    renderWithMantine(
      <MonitoringScreen
        tabs={TABS}
        value="Network"
        onChange={vi.fn()}
        onClose={vi.fn()}
        screens={{ Logs: <div>logs-body</div> }}
      />,
    );
    expect(screen.queryByText("logs-body")).toBeNull();
  });
});
