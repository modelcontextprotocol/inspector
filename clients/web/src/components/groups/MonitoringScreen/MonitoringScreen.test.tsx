import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  MonitoringScreen,
  type MonitoringScreenProps,
} from "./MonitoringScreen";

const TABS = ["Logs", "History", "Network"];

function screens() {
  return {
    Logs: <div>logs-body</div>,
    History: <div>history-body</div>,
    Network: <div>network-body</div>,
  };
}

function renderScreen(overrides: Partial<MonitoringScreenProps> = {}) {
  const props: MonitoringScreenProps = {
    tabs: TABS,
    value: "Logs",
    onChange: vi.fn(),
    searchValue: "",
    onSearchChange: vi.fn(),
    onClose: vi.fn(),
    screens: screens(),
    ...overrides,
  };
  renderWithMantine(<MonitoringScreen {...props} />);
  return props;
}

describe("MonitoringScreen", () => {
  it("renders the screen for the active tab", () => {
    renderScreen({ value: "History" });
    expect(screen.getByText("history-body")).toBeInTheDocument();
    expect(screen.queryByText("logs-body")).toBeNull();
    expect(screen.queryByText("network-body")).toBeNull();
  });

  it("renders the controls tab row", () => {
    renderScreen();
    expect(screen.getByRole("radio", { name: "Logs" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close monitoring column" }),
    ).toBeInTheDocument();
  });

  it("forwards tab changes and close from the controls", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClose = vi.fn();
    renderScreen({ onChange, onClose });
    await user.click(screen.getByRole("radio", { name: "Network" }));
    expect(onChange).toHaveBeenCalledWith("Network");
    await user.click(
      screen.getByRole("button", { name: "Close monitoring column" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("forwards the search value and changes from the controls", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderScreen({ searchValue: "hi", onSearchChange });
    const box = screen.getByRole("textbox", { name: "Search" });
    expect(box).toHaveValue("hi");
    await user.type(box, "!");
    expect(onSearchChange).toHaveBeenCalledWith("hi!");
  });

  it("renders nothing in the slot when the active tab has no screen", () => {
    renderScreen({ value: "Network", screens: { Logs: <div>logs-body</div> } });
    expect(screen.queryByText("logs-body")).toBeNull();
  });
});
