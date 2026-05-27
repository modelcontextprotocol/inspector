import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { FetchRequestEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { NetworkScreen } from "./NetworkScreen";

const transportEntry: FetchRequestEntry = {
  id: "t-1",
  timestamp: new Date("2026-03-17T10:00:00Z"),
  method: "POST",
  url: "https://example.com/mcp",
  requestHeaders: { "x-test": "hello" },
  responseStatus: 200,
  responseStatusText: "OK",
  responseHeaders: { "content-type": "application/json" },
  duration: 45,
  category: "transport",
};

const authEntry: FetchRequestEntry = {
  id: "a-1",
  timestamp: new Date("2026-03-17T10:01:00Z"),
  method: "POST",
  url: "https://example.com/oauth/token",
  requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
  responseStatus: 200,
  responseHeaders: { "content-type": "application/json" },
  duration: 120,
  category: "auth",
};

const errorEntry: FetchRequestEntry = {
  id: "e-1",
  timestamp: new Date("2026-03-17T10:02:00Z"),
  method: "GET",
  url: "https://example.com/mcp",
  requestHeaders: {},
  error: "Network error",
  category: "transport",
};

const baseProps = {
  entries: [transportEntry, authEntry, errorEntry],
  onClear: vi.fn(),
  onExport: vi.fn(),
};

describe("NetworkScreen", () => {
  it("renders the network controls and panel", () => {
    renderWithMantine(<NetworkScreen {...baseProps} />);
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    expect(screen.getByText("Filter by Category")).toBeInTheDocument();
  });

  it("renders empty state when there are no entries", () => {
    renderWithMantine(<NetworkScreen {...baseProps} entries={[]} />);
    expect(screen.getByText("No network requests")).toBeInTheDocument();
  });

  it("shows entry headers when expanded", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <NetworkScreen {...baseProps} entries={[transportEntry]} />,
    );
    expect(screen.getByText("https://example.com/mcp")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("Request Headers")).toBeInTheDocument();
    expect(screen.getByText("x-test")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("Response Headers")).toBeInTheDocument();
  });

  it("filters by category when a category is toggled off", async () => {
    const user = userEvent.setup();
    renderWithMantine(<NetworkScreen {...baseProps} />);
    expect(
      screen.getByText("https://example.com/oauth/token"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "auth" }));
    expect(
      screen.queryByText("https://example.com/oauth/token"),
    ).not.toBeInTheDocument();
  });

  it("Deselect All hides every entry; Select All restores them", async () => {
    const user = userEvent.setup();
    renderWithMantine(<NetworkScreen {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "Deselect All" }));
    expect(screen.getByText("No network requests")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select All" }));
    expect(
      screen.getByText("https://example.com/oauth/token"),
    ).toBeInTheDocument();
  });

  it("filters by search text across URL, method, status, and headers", async () => {
    const user = userEvent.setup();
    renderWithMantine(<NetworkScreen {...baseProps} />);
    await user.type(screen.getByPlaceholderText("Search..."), "oauth");
    expect(
      screen.getByText("https://example.com/oauth/token"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("https://example.com/mcp"),
    ).not.toBeInTheDocument();
  });

  it("invokes onClear when Clear is clicked", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderWithMantine(<NetworkScreen {...baseProps} onClear={onClear} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("invokes onExport when Export is clicked", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    renderWithMantine(<NetworkScreen {...baseProps} onExport={onExport} />);
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("disables Clear / Export when there are no entries", () => {
    renderWithMantine(<NetworkScreen {...baseProps} entries={[]} />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });
});
