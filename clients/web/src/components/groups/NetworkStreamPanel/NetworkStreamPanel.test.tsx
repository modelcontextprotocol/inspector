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
  sortDirection: "newest-first" as const,
  onSortChange: vi.fn(),
  compact: true,
  onToggleCompact: vi.fn(),
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

  it("does not match across field boundaries", () => {
    // The method "POST" ends with "ST"; the URL begins with "https". A
    // search for "sthttps" used to match because we joined fields with
    // spaces and ran .includes on the joined string. Should not match.
    renderWithMantine(
      <NetworkStreamPanel {...baseProps} filterText="sthttps" />,
    );
    expect(screen.getByText("No network requests")).toBeInTheDocument();
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

  it("renders entries collapsed when compact is true", () => {
    renderWithMantine(<NetworkStreamPanel {...baseProps} compact />);
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
  });

  it("renders entries expanded when compact is false", () => {
    renderWithMantine(<NetworkStreamPanel {...baseProps} compact={false} />);
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("invokes onToggleCompact when the ListToggle is clicked", async () => {
    const user = userEvent.setup();
    const onToggleCompact = vi.fn();
    renderWithMantine(
      <NetworkStreamPanel {...baseProps} onToggleCompact={onToggleCompact} />,
    );
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(onToggleCompact).toHaveBeenCalledTimes(1);
  });

  it("renders entries newest-first by default", () => {
    const older: FetchRequestEntry = {
      ...entry,
      id: "older",
      url: "https://example.com/older",
      timestamp: new Date("2026-03-17T09:00:00Z"),
    };
    const newer: FetchRequestEntry = {
      ...entry,
      id: "newer",
      url: "https://example.com/newer",
      timestamp: new Date("2026-03-17T11:00:00Z"),
    };
    renderWithMantine(
      <NetworkStreamPanel {...baseProps} entries={[older, newer]} />,
    );
    const urls = screen.getAllByText(/example\.com\//);
    expect(urls[0]).toHaveTextContent("https://example.com/newer");
    expect(urls[urls.length - 1]).toHaveTextContent(
      "https://example.com/older",
    );
  });

  it("reorders entries when sortDirection is oldest-first", () => {
    const older: FetchRequestEntry = {
      ...entry,
      id: "older",
      url: "https://example.com/older",
      timestamp: new Date("2026-03-17T09:00:00Z"),
    };
    const newer: FetchRequestEntry = {
      ...entry,
      id: "newer",
      url: "https://example.com/newer",
      timestamp: new Date("2026-03-17T11:00:00Z"),
    };
    renderWithMantine(
      <NetworkStreamPanel
        {...baseProps}
        entries={[newer, older]}
        sortDirection="oldest-first"
      />,
    );
    const urls = screen.getAllByText(/example\.com\//);
    expect(urls[0]).toHaveTextContent("https://example.com/older");
    expect(urls[urls.length - 1]).toHaveTextContent(
      "https://example.com/newer",
    );
  });

  it("invokes onSortChange when the user picks a new sort", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderWithMantine(
      <NetworkStreamPanel {...baseProps} onSortChange={onSortChange} />,
    );
    await user.click(
      screen.getByRole("textbox", { name: "Network sort direction" }),
    );
    await user.click(await screen.findByText("Sort: Oldest First"));
    expect(onSortChange).toHaveBeenCalledWith("oldest-first");
  });
});
