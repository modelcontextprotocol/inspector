import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { LogControls } from "./LogControls";

const allVisible: Record<LoggingLevel, boolean> = {
  debug: true,
  info: true,
  notice: true,
  warning: true,
  error: true,
  critical: true,
  alert: true,
  emergency: true,
};

const someVisible: Record<LoggingLevel, boolean> = {
  debug: false,
  info: false,
  notice: false,
  warning: true,
  error: true,
  critical: true,
  alert: true,
  emergency: true,
};

const baseProps = {
  currentLevel: "info" as LoggingLevel,
  filterText: "",
  visibleLevels: allVisible,
  onSetLevel: vi.fn(),
  onFilterChange: vi.fn(),
  onToggleLevel: vi.fn(),
  onToggleAllLevels: vi.fn(),
};

describe("LogControls", () => {
  it("renders the title and search input", () => {
    renderWithMantine(<LogControls {...baseProps} />);
    expect(screen.getByText("Logging")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    expect(screen.getByText("Set Active Level")).toBeInTheDocument();
    expect(screen.getByText("Filter by Level")).toBeInTheDocument();
  });

  it("renders a button for each log level", () => {
    renderWithMantine(<LogControls {...baseProps} />);
    expect(screen.getByRole("button", { name: "debug" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "info" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "notice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "warning" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "error" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "critical" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "alert" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "emergency" }),
    ).toBeInTheDocument();
  });

  it("displays the current active level in the select", () => {
    renderWithMantine(<LogControls {...baseProps} currentLevel="warning" />);
    const inputs = screen.getAllByDisplayValue("warning");
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("invokes onFilterChange when typing in search", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    renderWithMantine(
      <LogControls {...baseProps} onFilterChange={onFilterChange} />,
    );
    await user.type(screen.getByPlaceholderText("Search..."), "x");
    expect(onFilterChange).toHaveBeenCalledWith("x");
  });

  it("invokes onSetLevel when Set is clicked", async () => {
    const user = userEvent.setup();
    const onSetLevel = vi.fn();
    renderWithMantine(
      <LogControls
        {...baseProps}
        currentLevel="warning"
        onSetLevel={onSetLevel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Set" }));
    expect(onSetLevel).toHaveBeenCalledWith("warning");
  });

  it("invokes onSetLevel when a level is selected from dropdown", async () => {
    const user = userEvent.setup();
    const onSetLevel = vi.fn();
    renderWithMantine(<LogControls {...baseProps} onSetLevel={onSetLevel} />);
    // Open the select dropdown
    const inputs = screen.getAllByDisplayValue("info");
    await user.click(inputs[0]);
    const errorOption = await screen.findByRole("option", {
      name: "error",
      hidden: true,
    });
    await user.click(errorOption);
    expect(onSetLevel).toHaveBeenCalledWith("error");
  });

  it("renders Deselect All when all levels are visible", () => {
    renderWithMantine(<LogControls {...baseProps} />);
    expect(
      screen.getByRole("button", { name: "Deselect All" }),
    ).toBeInTheDocument();
  });

  it("renders Select All when not all levels are visible", () => {
    renderWithMantine(
      <LogControls {...baseProps} visibleLevels={someVisible} />,
    );
    expect(
      screen.getByRole("button", { name: "Select All" }),
    ).toBeInTheDocument();
  });

  it("invokes onToggleAllLevels when toggle-all button is clicked", async () => {
    const user = userEvent.setup();
    const onToggleAllLevels = vi.fn();
    renderWithMantine(
      <LogControls {...baseProps} onToggleAllLevels={onToggleAllLevels} />,
    );
    await user.click(screen.getByRole("button", { name: "Deselect All" }));
    expect(onToggleAllLevels).toHaveBeenCalledTimes(1);
  });

  it("invokes onToggleLevel when a level button is clicked", async () => {
    const user = userEvent.setup();
    const onToggleLevel = vi.fn();
    renderWithMantine(
      <LogControls {...baseProps} onToggleLevel={onToggleLevel} />,
    );
    await user.click(screen.getByRole("button", { name: "debug" }));
    expect(onToggleLevel).toHaveBeenCalledWith("debug", false);
  });

  it("invokes onToggleLevel with true when an inactive level is clicked", async () => {
    const user = userEvent.setup();
    const onToggleLevel = vi.fn();
    renderWithMantine(
      <LogControls
        {...baseProps}
        visibleLevels={someVisible}
        onToggleLevel={onToggleLevel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "debug" }));
    expect(onToggleLevel).toHaveBeenCalledWith("debug", true);
  });
});
