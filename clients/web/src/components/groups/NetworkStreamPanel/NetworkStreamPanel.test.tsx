import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { FetchRequestEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { NetworkStreamPanel } from "./NetworkStreamPanel";

const entry: FetchRequestEntry = {
  id: "n-1",
  timestamp: new Date("2026-03-17T10:00:00Z"),
  method: "POST",
  url: "https://example.com/mcp",
  requestHeaders: {
    authorization: "Bearer abc",
    "content-type": "application/json",
  },
  requestBody: '{"jsonrpc":"2.0","method":"initialize","id":1}',
  responseStatus: 200,
  responseStatusText: "OK",
  responseHeaders: { "content-type": "application/json" },
  responseBody: '{"jsonrpc":"2.0","id":1,"result":{}}',
  category: "transport",
};

const baseProps = {
  entries: [entry],
  filterText: "",
  visibleCategories: { auth: true, transport: true } as const,
  onClear: vi.fn(),
  onExport: vi.fn(),
};

describe("NetworkStreamPanel", () => {
  it("renders entries when present", () => {
    renderWithMantine(<NetworkStreamPanel {...baseProps} />);
    expect(screen.getByText("https://example.com/mcp")).toBeInTheDocument();
    expect(screen.getByText("Requests (1)")).toBeInTheDocument();
  });

  it("renders the empty state when filters hide everything", () => {
    renderWithMantine(
      <NetworkStreamPanel
        {...baseProps}
        visibleCategories={{ auth: false, transport: false }}
      />,
    );
    expect(screen.getByText("No network requests")).toBeInTheDocument();
  });

  it("filters entries by search text", () => {
    renderWithMantine(<NetworkStreamPanel {...baseProps} filterText="oauth" />);
    expect(screen.getByText("No network requests")).toBeInTheDocument();
  });

  it("filters entries by URL match", () => {
    renderWithMantine(
      <NetworkStreamPanel {...baseProps} filterText="example.com" />,
    );
    expect(screen.getByText("https://example.com/mcp")).toBeInTheDocument();
  });

  it("matches against header keys and values", () => {
    renderWithMantine(
      <NetworkStreamPanel {...baseProps} filterText="content-type" />,
    );
    expect(screen.getByText("https://example.com/mcp")).toBeInTheDocument();
  });

  it("matches against the request body", () => {
    renderWithMantine(
      <NetworkStreamPanel {...baseProps} filterText="initialize" />,
    );
    expect(screen.getByText("https://example.com/mcp")).toBeInTheDocument();
  });

  it("matches against the response body", () => {
    renderWithMantine(
      <NetworkStreamPanel {...baseProps} filterText="jsonrpc" />,
    );
    expect(screen.getByText("https://example.com/mcp")).toBeInTheDocument();
  });

  it("matches against responseStatusText", () => {
    renderWithMantine(<NetworkStreamPanel {...baseProps} filterText="ok" />);
    expect(screen.getByText("https://example.com/mcp")).toBeInTheDocument();
  });

  it("is case-insensitive", () => {
    renderWithMantine(
      <NetworkStreamPanel {...baseProps} filterText="CONTENT-TYPE" />,
    );
    expect(screen.getByText("https://example.com/mcp")).toBeInTheDocument();
  });

  it("invokes onClear and onExport", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const onExport = vi.fn();
    renderWithMantine(
      <NetworkStreamPanel
        {...baseProps}
        onClear={onClear}
        onExport={onExport}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("disables Clear / Export when there are no entries at all", () => {
    renderWithMantine(<NetworkStreamPanel {...baseProps} entries={[]} />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("toggles between compact and expanded list views", async () => {
    const user = userEvent.setup();
    renderWithMantine(<NetworkStreamPanel {...baseProps} />);
    // List starts compact -> entry should show Expand button
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    // The first icon button (ListToggle) is the toggle next to Clear/Export.
    // Identify it by being the first button that is neither Clear, Export,
    // nor an Expand/Collapse inside an entry.
    const buttons = screen.getAllByRole("button");
    const toggle = buttons.find((b) => {
      const text = b.textContent ?? "";
      return !/Clear|Export|Expand|Collapse/.test(text);
    });
    expect(toggle).toBeDefined();
    await user.click(toggle!);
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });
});
