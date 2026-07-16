import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/client";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { AppControls, type AppControlsProps } from "./AppControls";

const sampleApps: Tool[] = [
  {
    name: "weather",
    title: "Weather Widget",
    inputSchema: { type: "object" },
    _meta: { ui: { resourceUri: "ui://apps/weather" } },
  },
  {
    name: "ops",
    title: "Ops Dashboard",
    inputSchema: { type: "object" },
    _meta: { ui: { resourceUri: "ui://apps/ops" } },
  },
  {
    name: "git_status",
    inputSchema: { type: "object" },
    _meta: { ui: { resourceUri: "ui://apps/git-status" } },
  },
];

const baseProps = {
  tools: sampleApps,
  listChanged: false,
  onRefreshList: vi.fn(),
  onSelectApp: vi.fn(),
  onSearchChange: vi.fn(),
};

// The search box is controlled: typing fires onSearchChange but does not
// update the component's own state. This host holds the searchText state so
// interaction tests that filter by typing behave like the real parent.
function ControlledAppControls(props: Partial<AppControlsProps>) {
  const [searchText, setSearchText] = useState(props.searchText ?? "");
  return (
    <AppControls
      {...baseProps}
      {...props}
      searchText={searchText}
      onSearchChange={(value) => {
        setSearchText(value);
        props.onSearchChange?.(value);
      }}
    />
  );
}

describe("AppControls", () => {
  it("renders the title with the app count and a search input", () => {
    renderWithMantine(<AppControls {...baseProps} />);
    expect(screen.getByText("MCP Apps (3)")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search apps...")).toBeInTheDocument();
  });

  it("renders all apps by default", () => {
    renderWithMantine(<AppControls {...baseProps} />);
    expect(screen.getByText("Weather Widget")).toBeInTheDocument();
    expect(screen.getByText("Ops Dashboard")).toBeInTheDocument();
    expect(screen.getByText("git_status")).toBeInTheDocument();
  });

  it("filters apps by name when typing in the search input", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledAppControls />);
    await user.type(screen.getByPlaceholderText("Search apps..."), "git");
    expect(screen.getByText("git_status")).toBeInTheDocument();
    expect(screen.queryByText("Weather Widget")).not.toBeInTheDocument();
  });

  it("filters apps by title when typing in the search input", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledAppControls />);
    await user.type(
      screen.getByPlaceholderText("Search apps..."),
      "weather widget",
    );
    expect(screen.getByText("Weather Widget")).toBeInTheDocument();
    expect(screen.queryByText("Ops Dashboard")).not.toBeInTheDocument();
  });

  it("shows 'No apps available' when the tool list is empty", () => {
    renderWithMantine(<AppControls {...baseProps} tools={[]} />);
    expect(screen.getByText("No apps available")).toBeInTheDocument();
    expect(screen.getByText("MCP Apps (0)")).toBeInTheDocument();
  });

  it("shows 'No matching apps' when search yields no results", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledAppControls />);
    await user.type(screen.getByPlaceholderText("Search apps..."), "zzz");
    expect(screen.getByText("No matching apps")).toBeInTheDocument();
  });

  it("clears the search via the clear button, invoking onSearchChange with empty string", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderWithMantine(
      <ControlledAppControls onSearchChange={onSearchChange} />,
    );
    const input = screen.getByPlaceholderText("Search apps...");
    await user.type(input, "git");
    // The clear button only renders once searchText is non-empty (line 67).
    const clearButton = screen.getByRole("button", { name: /clear/i });
    await user.click(clearButton);
    expect(onSearchChange).toHaveBeenLastCalledWith("");
  });

  it("invokes onSelectApp when an unselected app is clicked", async () => {
    const user = userEvent.setup();
    const onSelectApp = vi.fn();
    renderWithMantine(<AppControls {...baseProps} onSelectApp={onSelectApp} />);
    await user.click(screen.getByText("git_status"));
    expect(onSelectApp).toHaveBeenCalledWith("git_status");
  });

  it("does not invoke onSelectApp when the already-selected app is clicked", async () => {
    const user = userEvent.setup();
    const onSelectApp = vi.fn();
    renderWithMantine(
      <AppControls
        {...baseProps}
        selectedName="git_status"
        onSelectApp={onSelectApp}
      />,
    );
    await user.click(screen.getByText("git_status"));
    expect(onSelectApp).not.toHaveBeenCalled();
  });

  it("does not show the list-changed indicator (and no Refresh) when listChanged is false", () => {
    renderWithMantine(<AppControls {...baseProps} />);
    expect(screen.queryByText("List updated")).not.toBeInTheDocument();
    // The indicator is the sole refresh affordance, so there's no standalone
    // toolbar Refresh button to duplicate it.
    expect(
      screen.queryByRole("button", { name: "Refresh" }),
    ).not.toBeInTheDocument();
  });

  it("shows a single Refresh via the list-changed indicator when listChanged is true", async () => {
    const user = userEvent.setup();
    const onRefreshList = vi.fn();
    renderWithMantine(
      <AppControls {...baseProps} listChanged onRefreshList={onRefreshList} />,
    );
    expect(screen.getByText("List updated")).toBeInTheDocument();
    // Exactly one Refresh button — the indicator's — not a duplicate alongside
    // a standalone toolbar button.
    const refreshButtons = screen.getAllByRole("button", { name: "Refresh" });
    expect(refreshButtons).toHaveLength(1);
    await user.click(refreshButtons[0]);
    expect(onRefreshList).toHaveBeenCalledTimes(1);
  });
});
