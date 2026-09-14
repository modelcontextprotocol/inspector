import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/client";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ToolControls, type ToolControlsProps } from "./ToolControls";
import { noopPagination } from "../../../test/fixtures/pagination";

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
  pagination: noopPagination,
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
    expect(onSelectTool).toHaveBeenCalledWith("2:git_status");
  });

  it("does not invoke onSelectTool when the already-selected tool is clicked", async () => {
    const user = userEvent.setup();
    const onSelectTool = vi.fn();
    renderWithMantine(
      <ToolControls
        {...baseProps}
        selectedKey="2:git_status"
        onSelectTool={onSelectTool}
      />,
    );
    await user.click(screen.getByText("git_status"));
    expect(onSelectTool).not.toHaveBeenCalled();
  });

  it("selects each copy of a duplicated tool name independently", async () => {
    // A `tools/list` may repeat a name. Selection is keyed by row identity, so
    // selecting the first copy must leave the second clickable and unhighlighted
    // (#2001 — with a name-keyed selection both highlighted and neither of the
    // later copies could be opened).
    const user = userEvent.setup();
    const onSelectTool = vi.fn();
    const duplicated: Tool[] = [
      { name: "get_weather", inputSchema: { type: "object" } },
      { name: "echo", inputSchema: { type: "object" } },
      { name: "get_weather", inputSchema: { type: "object" } },
    ];
    renderWithMantine(
      <ToolControls
        {...baseProps}
        tools={duplicated}
        selectedKey="0:get_weather"
        onSelectTool={onSelectTool}
      />,
    );
    const rows = screen.getAllByText("get_weather");
    expect(rows).toHaveLength(2);
    // Only the selected row carries the highlight background.
    const highlighted = rows
      .map((row) => row.closest("button"))
      .filter((button) => button?.style.background !== "");
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toBe(rows[0]?.closest("button"));

    // The second copy is still clickable, and reports its own row key.
    await user.click(rows[1] as HTMLElement);
    expect(onSelectTool).toHaveBeenCalledWith("2:get_weather");
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

  const excludedFixture = [
    {
      tool: {
        name: "invalid_header_tool",
        inputSchema: { type: "object" as const },
      },
      reason:
        "value: x-mcp-header 'Bad Header' is not a valid RFC 9110 token (no spaces, control characters or HTTP delimiters)",
    },
  ];

  it("renders excluded tools with a header and the tool name (#1632)", () => {
    renderWithMantine(
      <ToolControls {...baseProps} excludedTools={excludedFixture} />,
    );
    expect(screen.getByText("Excluded (SEP-2243)")).toBeInTheDocument();
    expect(screen.getByText("invalid_header_tool")).toBeInTheDocument();
  });

  it("does not render the excluded section when there are none", () => {
    renderWithMantine(<ToolControls {...baseProps} excludedTools={[]} />);
    expect(screen.queryByText("Excluded (SEP-2243)")).not.toBeInTheDocument();
  });

  it("filters excluded tools by the search text (#1632)", () => {
    renderWithMantine(
      <ToolControls
        {...baseProps}
        excludedTools={excludedFixture}
        searchText="git"
      />,
    );
    // The search matches no excluded tool, so the section is hidden.
    expect(screen.queryByText("Excluded (SEP-2243)")).not.toBeInTheDocument();
    expect(screen.queryByText("invalid_header_tool")).not.toBeInTheDocument();
  });

  it("keeps a matching excluded tool visible under search (#1632)", () => {
    renderWithMantine(
      <ToolControls
        {...baseProps}
        excludedTools={excludedFixture}
        searchText="invalid"
      />,
    );
    expect(screen.getByText("invalid_header_tool")).toBeInTheDocument();
  });

  // A failed load is rendered above the list instead of leaving the panel
  // empty, which is indistinguishable from a server that has none (#1953).
  it("renders a failed load above the list and retries via onRefreshList", async () => {
    const user = userEvent.setup();
    const onRefreshList = vi.fn();
    renderWithMantine(
      <ToolControls
        {...baseProps}
        loadError={new Error("codec said no")}
        onRefreshList={onRefreshList}
      />,
    );

    expect(screen.getByText("Couldn't load tools")).toBeInTheDocument();
    expect(screen.getByText("codec said no")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRefreshList).toHaveBeenCalledTimes(1);
  });

  // A server may legitimately return the same tool name twice; keying rows by
  // name alone collides, and React then reuses the stale row instead of
  // unmounting it when the filter narrows (#1957).
  const duplicateNameTools: Tool[] = [
    {
      name: "get_record",
      title: "Get Record First",
      inputSchema: { type: "object" },
    },
    {
      name: "duplicate_tool",
      title: "First Duplicate",
      inputSchema: { type: "object" },
    },
    {
      name: "unrelated_tool",
      title: "Unrelated Tool First",
      inputSchema: { type: "object" },
    },
    {
      name: "duplicate_tool",
      title: "Second Duplicate",
      inputSchema: { type: "object" },
    },
    {
      name: "get_record",
      title: "Get Record Second",
      inputSchema: { type: "object" },
    },
    {
      name: "unrelated_tool",
      title: "Unrelated Tool Second",
      inputSchema: { type: "object" },
    },
  ];

  it("removes every non-matching row when tool names repeat (#1957)", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledToolControls tools={duplicateNameTools} />);

    await user.type(screen.getByPlaceholderText("Search tools..."), "get");

    expect(screen.getByText("Get Record First")).toBeInTheDocument();
    expect(screen.getByText("Get Record Second")).toBeInTheDocument();
    for (const stale of [
      "First Duplicate",
      "Second Duplicate",
      "Unrelated Tool First",
      "Unrelated Tool Second",
    ]) {
      expect(screen.queryByText(stale)).not.toBeInTheDocument();
    }
  });

  // The shape `test-servers/configs/duplicate-tool-names-http.json` serves: the
  // repeats are appended after the whole list rather than sitting beside their
  // twin. Distinct from the fixture above and worth its own case — React
  // matches a leading run of same-key children first, so where the duplicates
  // sit decides which row gets orphaned (#1957).
  const appendedDuplicateTools: Tool[] = [
    { name: "get_weather", inputSchema: { type: "object" } },
    { name: "get_temp", inputSchema: { type: "object" } },
    { name: "echo", inputSchema: { type: "object" } },
    { name: "add", inputSchema: { type: "object" } },
    {
      name: "get_weather",
      title: "get_weather (duplicate)",
      inputSchema: { type: "object" },
    },
    {
      name: "echo",
      title: "echo (duplicate)",
      inputSchema: { type: "object" },
    },
  ];

  it("removes every non-matching row when repeats are appended (#1957)", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ControlledToolControls tools={appendedDuplicateTools} />,
    );

    await user.type(screen.getByPlaceholderText("Search tools..."), "get");

    expect(screen.getByText("get_temp")).toBeInTheDocument();
    expect(screen.getByText("get_weather (duplicate)")).toBeInTheDocument();
    expect(screen.queryByText("add")).not.toBeInTheDocument();
    // The row the collision orphaned on the broken build.
    expect(screen.queryByText("echo")).not.toBeInTheDocument();
    expect(screen.queryByText("echo (duplicate)")).not.toBeInTheDocument();
  });

  it("removes every non-matching excluded row when names repeat (#1957)", async () => {
    const user = userEvent.setup();
    const duplicateExcluded = [
      {
        tool: { name: "get_thing", inputSchema: { type: "object" as const } },
        reason: "a",
      },
      {
        tool: { name: "dupe", inputSchema: { type: "object" as const } },
        reason: "b",
      },
      {
        tool: { name: "dupe", inputSchema: { type: "object" as const } },
        reason: "c",
      },
      {
        tool: { name: "get_other", inputSchema: { type: "object" as const } },
        reason: "d",
      },
    ];
    renderWithMantine(
      <ControlledToolControls tools={[]} excludedTools={duplicateExcluded} />,
    );

    await user.type(screen.getByPlaceholderText("Search tools..."), "get");

    expect(screen.getByText("get_thing")).toBeInTheDocument();
    expect(screen.getByText("get_other")).toBeInTheDocument();
    expect(screen.queryByText("dupe")).not.toBeInTheDocument();
  });

  it("renders no load error by default", () => {
    renderWithMantine(<ToolControls {...baseProps} />);
    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
  });
});
