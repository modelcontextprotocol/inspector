import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { LoggingScreen } from "./LoggingScreen";

const baseProps = {
  entries: [],
  currentLevel: "info" as const,
  onSetLevel: vi.fn(),
  onClear: vi.fn(),
  onExport: vi.fn(),
  autoScroll: true,
  onToggleAutoScroll: vi.fn(),
  onCopyAll: vi.fn(),
};

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
    renderWithMantine(<LoggingScreen {...baseProps} onClear={onClear} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("invokes onCopyAll when Copy All is clicked", async () => {
    const user = userEvent.setup();
    const onCopyAll = vi.fn();
    renderWithMantine(<LoggingScreen {...baseProps} onCopyAll={onCopyAll} />);
    await user.click(screen.getByRole("button", { name: "Copy All" }));
    expect(onCopyAll).toHaveBeenCalledTimes(1);
  });

  it("toggles a single level on level button click", async () => {
    const user = userEvent.setup();
    const entries = [
      { receivedAt: new Date(), params: { level: "info" as const, data: "x" } },
    ];
    renderWithMantine(<LoggingScreen {...baseProps} entries={entries} />);
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
    renderWithMantine(<LoggingScreen {...baseProps} entries={entries} />);
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
    renderWithMantine(<LoggingScreen {...baseProps} entries={entries} />);
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
