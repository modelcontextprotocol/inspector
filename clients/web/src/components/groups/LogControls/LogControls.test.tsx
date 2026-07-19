import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { LoggingLevel } from "@modelcontextprotocol/client";
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

  it("clears the search via the clear button, invoking onFilterChange with empty string", async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    renderWithMantine(
      <LogControls
        {...baseProps}
        filterText="warn"
        onFilterChange={onFilterChange}
      />,
    );
    // The clear button only renders when filterText is non-empty (line 62).
    const clearButton = screen.getByRole("button", { name: "Clear" });
    await user.click(clearButton);
    expect(onFilterChange).toHaveBeenCalledWith("");
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

  it("does not invoke onSetLevel when the dropdown selection is cleared", async () => {
    // The Select allows deselect (no allowDeselect override): clicking the
    // already-selected option fires onChange(null), exercising the falsy-`value`
    // arm of the guard (line 73) so onSetLevel is not called.
    const user = userEvent.setup();
    const onSetLevel = vi.fn();
    renderWithMantine(<LogControls {...baseProps} onSetLevel={onSetLevel} />);
    const inputs = screen.getAllByDisplayValue("info");
    await user.click(inputs[0]);
    const infoOption = await screen.findByRole("option", {
      name: "info",
      hidden: true,
    });
    await user.click(infoOption);
    expect(onSetLevel).not.toHaveBeenCalled();
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

  it("reflects level visibility via aria-pressed", () => {
    renderWithMantine(
      <LogControls {...baseProps} visibleLevels={someVisible} />,
    );
    expect(screen.getByRole("button", { name: "debug" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "warning" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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

  describe("modern era (#1629)", () => {
    it("replaces the legacy Set selector with the per-request control", () => {
      renderWithMantine(<LogControls {...baseProps} protocolEra="modern" />);
      // Legacy affordances are gone...
      expect(screen.queryByText("Set Active Level")).toBeNull();
      expect(screen.queryByRole("button", { name: "Set" })).toBeNull();
      // ...replaced by the per-request opt-in control + its explanation.
      expect(screen.getByText("Log Level per Request")).toBeInTheDocument();
      expect(
        screen.getByText(/logs arrive on the originating request/i),
      ).toBeInTheDocument();
      // Filter-by-level survives the era fork.
      expect(screen.getByText("Filter by Level")).toBeInTheDocument();
    });

    it("shows Off when not opted in", () => {
      renderWithMantine(
        <LogControls
          {...baseProps}
          protocolEra="modern"
          modernLogLevel={null}
        />,
      );
      expect(
        screen.getAllByDisplayValue("Off (no logs)").length,
      ).toBeGreaterThan(0);
    });

    it("shows the stamped level when opted in", () => {
      renderWithMantine(
        <LogControls
          {...baseProps}
          protocolEra="modern"
          modernLogLevel="warning"
        />,
      );
      expect(screen.getAllByDisplayValue("warning").length).toBeGreaterThan(0);
    });

    it("invokes onSetModernLogLevel with the chosen level", async () => {
      const user = userEvent.setup();
      const onSetModernLogLevel = vi.fn();
      renderWithMantine(
        <LogControls
          {...baseProps}
          protocolEra="modern"
          modernLogLevel={null}
          onSetModernLogLevel={onSetModernLogLevel}
        />,
      );
      await user.click(screen.getAllByDisplayValue("Off (no logs)")[0]);
      const errorOption = await screen.findByRole("option", {
        name: "error",
        hidden: true,
      });
      await user.click(errorOption);
      expect(onSetModernLogLevel).toHaveBeenCalledWith("error");
    });

    it("invokes onSetModernLogLevel with null when Off is chosen", async () => {
      const user = userEvent.setup();
      const onSetModernLogLevel = vi.fn();
      renderWithMantine(
        <LogControls
          {...baseProps}
          protocolEra="modern"
          modernLogLevel="debug"
          onSetModernLogLevel={onSetModernLogLevel}
        />,
      );
      await user.click(screen.getAllByDisplayValue("debug")[0]);
      const offOption = await screen.findByRole("option", {
        name: "Off (no logs)",
        hidden: true,
      });
      await user.click(offOption);
      expect(onSetModernLogLevel).toHaveBeenCalledWith(null);
    });
  });
});
