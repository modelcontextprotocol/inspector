import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/client";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ToolControls, type ToolControlsProps } from "./ToolControls";

const sampleTools: Tool[] = [
  { name: "list_files", title: "List Files", inputSchema: { type: "object" } },
  {
    name: "query_database",
    title: "Query DB",
    inputSchema: { type: "object" },
  },
  { name: "git_status", inputSchema: { type: "object" } },
  { name: "git_commit", inputSchema: { type: "object" } },
];

const baseProps = {
  tools: sampleTools,
  listChanged: false,
  onRefreshList: vi.fn(),
  onSelectTool: vi.fn(),
  onSearchChange: vi.fn(),
};

// The search box is controlled: typing fires onSearchChange but does not
// update the component's own state. This host holds the searchText state so
// interaction tests that filter by typing behave like the real parent.
function ControlledToolControls(props: Partial<ToolControlsProps>) {
  const [searchText, setSearchText] = useState(props.searchText ?? "");
  return (
    <ToolControls
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

describe("ToolControls", () => {
  it("renders the title and search input", () => {
    renderWithMantine(<ToolControls {...baseProps} />);
    expect(screen.getByText("Tools")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search tools...")).toBeInTheDocument();
  });

  it("renders all tools by default", () => {
    renderWithMantine(<ToolControls {...baseProps} />);
    expect(screen.getByText("List Files")).toBeInTheDocument();
    expect(screen.getByText("Query DB")).toBeInTheDocument();
    expect(screen.getByText("git_status")).toBeInTheDocument();
    expect(screen.getByText("git_commit")).toBeInTheDocument();
  });

  it("filters tools by name when typing in the search input", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledToolControls />);
    await user.type(screen.getByPlaceholderText("Search tools..."), "git");
    expect(screen.getByText("git_status")).toBeInTheDocument();
    expect(screen.getByText("git_commit")).toBeInTheDocument();
    expect(screen.queryByText("List Files")).not.toBeInTheDocument();
  });

  it("filters tools by title when typing in the search input", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledToolControls />);
    await user.type(screen.getByPlaceholderText("Search tools..."), "query db");
    expect(screen.getByText("Query DB")).toBeInTheDocument();
    expect(screen.queryByText("List Files")).not.toBeInTheDocument();
  });

  it("invokes onSelectTool when an unselected tool is clicked", async () => {
    const user = userEvent.setup();
    const onSelectTool = vi.fn();
    renderWithMantine(
      <ToolControls {...baseProps} onSelectTool={onSelectTool} />,
    );
    await user.click(screen.getByText("git_status"));
    expect(onSelectTool).toHaveBeenCalledWith("git_status");
  });

  it("does not invoke onSelectTool when the already-selected tool is clicked", async () => {
    const user = userEvent.setup();
    const onSelectTool = vi.fn();
    renderWithMantine(
      <ToolControls
        {...baseProps}
        selectedName="git_status"
        onSelectTool={onSelectTool}
      />,
    );
    await user.click(screen.getByText("git_status"));
    expect(onSelectTool).not.toHaveBeenCalled();
  });

  it("does not show the list-changed indicator when listChanged is false", () => {
    renderWithMantine(<ToolControls {...baseProps} />);
    expect(screen.queryByText("List updated")).not.toBeInTheDocument();
  });

  it("shows the list-changed indicator when listChanged is true and invokes onRefreshList", async () => {
    const user = userEvent.setup();
    const onRefreshList = vi.fn();
    renderWithMantine(
      <ToolControls {...baseProps} listChanged onRefreshList={onRefreshList} />,
    );
    expect(screen.getByText("List updated")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefreshList).toHaveBeenCalledTimes(1);
  });

  it("clears the search via the Clear button", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderWithMantine(
      <ToolControls
        {...baseProps}
        searchText="git"
        onSearchChange={onSearchChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("renders empty list when no tools provided", () => {
    renderWithMantine(<ToolControls {...baseProps} tools={[]} />);
    expect(screen.getByText("Tools")).toBeInTheDocument();
    expect(screen.queryByText("git_status")).not.toBeInTheDocument();
  });
});
