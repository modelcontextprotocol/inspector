import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  LoggingScreen,
  type LoggingScreenProps,
  type LogsUiState,
} from "./LoggingScreen";
import { EMPTY_LOGS_UI } from "../screenUiState";

const baseProps = {
  entries: [],
  currentLevel: "info" as const,
  ui: EMPTY_LOGS_UI,
  onUiChange: vi.fn(),
  onSetLevel: vi.fn(),
  onClear: vi.fn(),
  onExport: vi.fn(),
  sortDirection: "newest-first" as const,
  onSortChange: vi.fn(),
};

// LoggingScreen is controlled: filter text + visible-level set live in the
// parent (App) as one `ui` object so they persist across tab navigation
// (#1417). This host holds that state so typing/toggling drives the rendered
// list, mirroring how App owns it. Props passed in override defaults; the
// stateful `ui` wiring is applied last so callers can still observe changes
// via the spied `onUiChange` callback.
function ControlledLoggingScreen(props: Partial<LoggingScreenProps>) {
  const [ui, setUi] = useState<LogsUiState>({ ...EMPTY_LOGS_UI, ...props.ui });
  return (
    <LoggingScreen
      {...baseProps}
      {...props}
      ui={ui}
      onUiChange={(value) => {
        setUi(value);
        props.onUiChange?.(value);
      }}
    />
  );
}

describe("LoggingScreen", () => {
  it("renders the log stream panel", () => {
    renderWithMantine(<LoggingScreen {...baseProps} />);
    expect(screen.getByText("Log Stream")).toBeInTheDocument();
    expect(screen.getByText("No log entries")).toBeInTheDocument();
  });

  it("renders log entries", () => {
    const entries = [
      {
        receivedAt: new Date(),
        params: { level: "info" as const, data: "hello" },
      },
    ];
    renderWithMantine(<LoggingScreen {...baseProps} entries={entries} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("invokes onClear when clear is clicked", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const entries = [
      { receivedAt: new Date(), params: { level: "info" as const, data: "x" } },
    ];
    renderWithMantine(
      <LoggingScreen {...baseProps} entries={entries} onClear={onClear} />,
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("disables Clear / Export when there are no entries", () => {
    renderWithMantine(<LoggingScreen {...baseProps} />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Copy All" }),
    ).not.toBeInTheDocument();
  });

  it("toggles a single level on level button click", async () => {
    const user = userEvent.setup();
    const entries = [
      { receivedAt: new Date(), params: { level: "info" as const, data: "x" } },
    ];
    renderWithMantine(<ControlledLoggingScreen entries={entries} />);
    expect(screen.getByText("x")).toBeInTheDocument();
    const debugButton = screen.getByRole("button", { name: "info" });
    await user.click(debugButton);
    expect(screen.queryByText("x")).not.toBeInTheDocument();
  });

  it("Deselect All hides all entries; Select All restores them", async () => {
    const user = userEvent.setup();
    const entries = [
      { receivedAt: new Date(), params: { level: "info" as const, data: "x" } },
    ];
    renderWithMantine(<ControlledLoggingScreen entries={entries} />);
    await user.click(screen.getByRole("button", { name: "Deselect All" }));
    expect(screen.queryByText("x")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select All" }));
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  it("filters log text via the search input", async () => {
    const user = userEvent.setup();
    const entries = [
      {
        receivedAt: new Date(),
        params: { level: "info" as const, data: "alpha" },
      },
      {
        receivedAt: new Date(),
        params: { level: "info" as const, data: "beta" },
      },
    ];
    renderWithMantine(<ControlledLoggingScreen entries={entries} />);
    await user.type(screen.getByPlaceholderText("Search..."), "alpha");
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).not.toBeInTheDocument();
  });

  it("invokes onSetLevel via the Set button", async () => {
    const user = userEvent.setup();
    const onSetLevel = vi.fn();
    renderWithMantine(<LoggingScreen {...baseProps} onSetLevel={onSetLevel} />);
    await user.click(screen.getByRole("button", { name: "Set" }));
    expect(onSetLevel).toHaveBeenCalledWith("info");
  });
});
