import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { LogEntry, type LogEntryData } from "./LogEntry";

const baseEntry = (
  overrides: Partial<LogEntryData["params"]>,
): LogEntryData => ({
  receivedAt: new Date("2024-01-01T00:00:00Z"),
  params: { level: "info", data: "hello", ...overrides },
});

describe("LogEntry", () => {
  it("renders the message text", () => {
    renderWithMantine(<LogEntry entry={baseEntry({ data: "the message" })} />);
    expect(screen.getByText("the message")).toBeInTheDocument();
  });

  it("renders the level badge", () => {
    renderWithMantine(<LogEntry entry={baseEntry({ level: "error" })} />);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("renders the logger name when present", () => {
    renderWithMantine(<LogEntry entry={baseEntry({ logger: "transport" })} />);
    expect(screen.getByText("[transport]")).toBeInTheDocument();
  });

  it("formats object data as JSON", () => {
    renderWithMantine(<LogEntry entry={baseEntry({ data: { code: 42 } })} />);
    expect(screen.getByText('{"code":42}')).toBeInTheDocument();
  });

  it("renders empty string for null data", () => {
    const { container } = renderWithMantine(
      <LogEntry entry={baseEntry({ data: null })} />,
    );
    expect(container.textContent).toContain("info");
  });
});
