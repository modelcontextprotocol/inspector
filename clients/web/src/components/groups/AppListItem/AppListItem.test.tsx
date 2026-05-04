import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { AppListItem } from "./AppListItem";

const baseTool: Tool = {
  name: "calculator",
  title: "Calculator",
  description: "Arithmetic operations",
  inputSchema: { type: "object" },
};

const ICON_SRC = "data:image/svg+xml,%3Csvg/%3E";

describe("AppListItem", () => {
  it("prefers the tool title over the name", () => {
    renderWithMantine(
      <AppListItem tool={baseTool} selected={false} onClick={() => {}} />,
    );
    expect(screen.getByText("Calculator")).toBeInTheDocument();
  });

  it("falls back to the name when title is missing", () => {
    renderWithMantine(
      <AppListItem
        tool={{ ...baseTool, title: undefined }}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("calculator")).toBeInTheDocument();
  });

  it("renders the description when provided", () => {
    renderWithMantine(
      <AppListItem tool={baseTool} selected={false} onClick={() => {}} />,
    );
    expect(screen.getByText("Arithmetic operations")).toBeInTheDocument();
  });

  it("does not render a description block when description is missing", () => {
    renderWithMantine(
      <AppListItem
        tool={{ ...baseTool, description: undefined }}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.queryByText("Arithmetic operations")).not.toBeInTheDocument();
  });

  it("renders the first icon when tool.icons is present", () => {
    renderWithMantine(
      <AppListItem
        tool={{ ...baseTool, icons: [{ src: ICON_SRC }] }}
        selected={false}
        onClick={() => {}}
      />,
    );
    const img = screen.getByRole("presentation");
    expect(img).toHaveAttribute("src", ICON_SRC);
  });

  it("does not render an icon when tool.icons is missing", () => {
    renderWithMantine(
      <AppListItem tool={baseTool} selected={false} onClick={() => {}} />,
    );
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
  });

  it("invokes onClick when the row is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithMantine(
      <AppListItem tool={baseTool} selected={false} onClick={onClick} />,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders the selected state without crashing", () => {
    renderWithMantine(
      <AppListItem tool={baseTool} selected onClick={() => {}} />,
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
