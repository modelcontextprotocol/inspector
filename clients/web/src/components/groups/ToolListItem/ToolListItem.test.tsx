import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ToolListItem } from "./ToolListItem";

const tool: Tool = {
  name: "my_tool",
  inputSchema: { type: "object" },
};

describe("ToolListItem", () => {
  it("renders the name when title is missing", () => {
    renderWithMantine(
      <ToolListItem tool={tool} selected={false} onClick={() => {}} />,
    );
    expect(screen.getByText("my_tool")).toBeInTheDocument();
  });

  it("renders title and name when title is present", () => {
    renderWithMantine(
      <ToolListItem
        tool={{ ...tool, title: "My Tool" }}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("My Tool")).toBeInTheDocument();
    expect(screen.getByText("my_tool")).toBeInTheDocument();
  });

  it("invokes onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithMantine(
      <ToolListItem tool={tool} selected={false} onClick={onClick} />,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders selected state without crashing", () => {
    renderWithMantine(<ToolListItem tool={tool} selected onClick={() => {}} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
