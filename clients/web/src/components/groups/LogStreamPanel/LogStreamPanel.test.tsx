import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { LogStreamPanel } from "./LogStreamPanel";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";

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

const entries: LogEntryData[] = [
  {
    receivedAt: new Date("2026-03-17T10:00:00Z"),
    params: { level: "info", data: "Server started", logger: "main" },
  },
  {
    receivedAt: new Date("2026-03-17T10:00:01Z"),
    params: { level: "error", data: "Failed to read", logger: "resources" },
  },
  {
    receivedAt: new Date("2026-03-17T10:00:02Z"),
    params: { level: "debug", data: "Loading config" },
  },
  {
    receivedAt: new Date("2026-03-17T10:00:03Z"),
    params: { level: "warning", data: { code: 42, msg: "deprecated" } },
  },
  {
    receivedAt: new Date("2026-03-17T10:00:04Z"),
    params: { level: "info", data: null },
  },
];

const baseProps = {
  entries,
  filterText: "",
  visibleLevels: allVisible,
  autoScroll: true,
  onToggleAutoScroll: vi.fn(),
  onCopyAll: vi.fn(),
  onClear: vi.fn(),
  onExport: vi.fn(),
};

describe("LogStreamPanel", () => {
  it("renders the title and toolbar buttons", () => {
    renderWithMantine(<LogStreamPanel {...baseProps} />);
    expect(screen.getByText("Log Stream")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy All" }),
    ).toBeInTheDocument();
  });

  it("renders log entries when provided", () => {
    renderWithMantine(<LogStreamPanel {...baseProps} />);
    expect(screen.getByText("Server started")).toBeInTheDocument();
    expect(screen.getByText("Failed to read")).toBeInTheDocument();
    expect(screen.getByText("Loading config")).toBeInTheDocument();
  });

  it("serializes object data as JSON", () => {
    renderWithMantine(<LogStreamPanel {...baseProps} />);
    expect(
      screen.getByText('{"code":42,"msg":"deprecated"}'),
    ).toBeInTheDocument();
  });

  it("renders empty state when there are no entries", () => {
    renderWithMantine(<LogStreamPanel {...baseProps} entries={[]} />);
    expect(screen.getByText("No log entries")).toBeInTheDocument();
  });

  it("renders empty state when all entries are filtered out", () => {
    const hideAll: Record<LoggingLevel, boolean> = {
      debug: false,
      info: false,
      notice: false,
      warning: false,
      error: false,
      critical: false,
      alert: false,
      emergency: false,
    };
    renderWithMantine(
      <LogStreamPanel {...baseProps} visibleLevels={hideAll} />,
    );
    expect(screen.getByText("No log entries")).toBeInTheDocument();
  });

  it("filters entries by visibleLevels", () => {
    const onlyError: Record<LoggingLevel, boolean> = {
      debug: false,
      info: false,
      notice: false,
      warning: false,
      error: true,
      critical: false,
      alert: false,
      emergency: false,
    };
    renderWithMantine(
      <LogStreamPanel {...baseProps} visibleLevels={onlyError} />,
    );
    expect(screen.getByText("Failed to read")).toBeInTheDocument();
    expect(screen.queryByText("Server started")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading config")).not.toBeInTheDocument();
  });

  it("filters entries by filterText against the data", () => {
    renderWithMantine(<LogStreamPanel {...baseProps} filterText="server" />);
    expect(screen.getByText("Server started")).toBeInTheDocument();
    expect(screen.queryByText("Failed to read")).not.toBeInTheDocument();
  });

  it("filters entries by filterText against the logger name", () => {
    renderWithMantine(<LogStreamPanel {...baseProps} filterText="resources" />);
    expect(screen.getByText("Failed to read")).toBeInTheDocument();
    expect(screen.queryByText("Server started")).not.toBeInTheDocument();
  });

  it("filters entries by filterText against the level", () => {
    renderWithMantine(<LogStreamPanel {...baseProps} filterText="debug" />);
    expect(screen.getByText("Loading config")).toBeInTheDocument();
    expect(screen.queryByText("Failed to read")).not.toBeInTheDocument();
  });

  it("invokes onClear when Clear is clicked", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderWithMantine(<LogStreamPanel {...baseProps} onClear={onClear} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("invokes onExport when Export is clicked", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    renderWithMantine(<LogStreamPanel {...baseProps} onExport={onExport} />);
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("invokes onCopyAll when Copy All is clicked", async () => {
    const user = userEvent.setup();
    const onCopyAll = vi.fn();
    renderWithMantine(<LogStreamPanel {...baseProps} onCopyAll={onCopyAll} />);
    await user.click(screen.getByRole("button", { name: "Copy All" }));
    expect(onCopyAll).toHaveBeenCalledTimes(1);
  });

  it("invokes onToggleAutoScroll when the auto-scroll checkbox is clicked", async () => {
    const user = userEvent.setup();
    const onToggleAutoScroll = vi.fn();
    renderWithMantine(
      <LogStreamPanel {...baseProps} onToggleAutoScroll={onToggleAutoScroll} />,
    );
    await user.click(screen.getByLabelText("Auto-scroll"));
    expect(onToggleAutoScroll).toHaveBeenCalledTimes(1);
  });

  it("renders auto-scroll checkbox with correct checked state", () => {
    renderWithMantine(<LogStreamPanel {...baseProps} autoScroll={false} />);
    expect(screen.getByLabelText("Auto-scroll")).not.toBeChecked();
  });
});
