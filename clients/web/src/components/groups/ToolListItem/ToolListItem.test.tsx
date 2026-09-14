import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/client";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ToolListItem } from "./ToolListItem";

const tool: Tool = {
  name: "my_tool",
  inputSchema: { type: "object" },
};

const ICON_SRC = "data:image/svg+xml,%3Csvg/%3E";

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

  it("renders the first icon when tool.icons is present", () => {
    renderWithMantine(
      <ToolListItem
        tool={{ ...tool, icons: [{ src: ICON_SRC }] }}
        selected={false}
        onClick={() => {}}
      />,
    );
    const img = screen.getByRole("presentation");
    expect(img).toHaveAttribute("src", ICON_SRC);
  });

  it("does not render an icon when tool.icons is missing", () => {
    renderWithMantine(
      <ToolListItem tool={tool} selected={false} onClick={() => {}} />,
    );
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
  });

  it("shows no schema flag for a clean tool", () => {
    renderWithMantine(
      <ToolListItem tool={tool} selected={false} onClick={() => {}} />,
    );
    expect(
      screen.queryByLabelText(/Schema portability/),
    ).not.toBeInTheDocument();
  });

  it("flags a tool whose schema carries an error-severity finding", () => {
    renderWithMantine(
      <ToolListItem
        tool={{
          ...tool,
          outputSchema: { type: "object", properties: { data: true } },
        }}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(
      screen.getByLabelText("Schema portability: 1 error"),
    ).toBeInTheDocument();
  });

  it("breaks a mixed tool down rather than labelling the total", () => {
    // One error plus one warning must not announce as "2 errors".
    renderWithMantine(
      <ToolListItem
        tool={{
          ...tool,
          inputSchema: {
            type: "object",
            properties: { a: { type: ["null", "boolean"] } },
          },
          outputSchema: { type: "object", properties: { data: true } },
        }}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(
      screen.getByLabelText("Schema portability: 1 error, 1 warning"),
    ).toBeInTheDocument();
  });

  it("flags a warning-only tool distinctly", () => {
    renderWithMantine(
      <ToolListItem
        tool={{
          ...tool,
          inputSchema: {
            type: "object",
            properties: { a: { type: ["null", "boolean"] } },
          },
        }}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(
      screen.getByLabelText("Schema portability: 1 warning"),
    ).toBeInTheDocument();
  });
});
