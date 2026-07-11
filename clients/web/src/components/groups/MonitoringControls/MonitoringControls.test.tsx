import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  MonitoringControls,
  type MonitoringControlsProps,
} from "./MonitoringControls";

const TABS = ["Logs", "Protocol", "Network"];

function renderControls(overrides: Partial<MonitoringControlsProps> = {}) {
  const props: MonitoringControlsProps = {
    tabs: TABS,
    value: "Logs",
    onChange: vi.fn(),
    searchValue: "",
    onSearchChange: vi.fn(),
    ...overrides,
  };
  renderWithMantine(<MonitoringControls {...props} />);
  return props;
}

describe("MonitoringControls", () => {
  it("renders a radio option for each available tab", () => {
    renderControls();
    for (const tab of TABS) {
      expect(screen.getByRole("radio", { name: tab })).toBeInTheDocument();
    }
  });

  it("renders only the tabs it is given", () => {
    renderControls({ tabs: ["Logs", "Protocol"] });
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.queryByRole("radio", { name: "Network" })).toBeNull();
  });

  it("gives the tab switcher an accessible name", () => {
    const { container } = renderWithMantine(
      <MonitoringControls
        tabs={TABS}
        value="Logs"
        onChange={vi.fn()}
        searchValue=""
        onSearchChange={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[aria-label="Monitoring screen"]'),
    ).not.toBeNull();
  });

  it("marks the active tab as selected", () => {
    renderControls({ value: "Protocol" });
    expect(screen.getByRole("radio", { name: "Protocol" })).toBeChecked();
  });

  it("calls onChange when a different tab is chosen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderControls({ onChange });
    await user.click(screen.getByRole("radio", { name: "Network" }));
    expect(onChange).toHaveBeenCalledWith("Network");
  });

  it("renders the search box with the current value", () => {
    renderControls({ searchValue: "auth" });
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveValue("auth");
  });

  it("calls onSearchChange as the user types", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderControls({ onSearchChange });
    await user.type(screen.getByRole("textbox", { name: "Search" }), "x");
    expect(onSearchChange).toHaveBeenCalledWith("x");
  });

  it("clears the search via the clear button", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderControls({ searchValue: "term", onSearchChange });
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("shows no clear button when the search is empty", () => {
    renderControls({ searchValue: "" });
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});
