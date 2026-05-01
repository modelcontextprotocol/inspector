import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ToolsScreen } from "./ToolsScreen";

const tools: Tool[] = [
  { name: "alpha", inputSchema: { type: "object" } },
  { name: "beta", inputSchema: { type: "object" } },
];

const baseProps = {
  tools,
  listChanged: false,
  onRefreshList: vi.fn(),
  onCallTool: vi.fn(),
};

describe("ToolsScreen", () => {
  it("renders the empty selection state", () => {
    renderWithMantine(<ToolsScreen {...baseProps} />);
    expect(
      screen.getByText("Select a tool to view details"),
    ).toBeInTheDocument();
    expect(screen.getByText("Results will appear here")).toBeInTheDocument();
  });

  it("shows the detail panel when a tool is selected", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ToolsScreen {...baseProps} />);
    await user.click(screen.getByText("alpha"));
    expect(
      screen.queryByText("Select a tool to view details"),
    ).not.toBeInTheDocument();
  });

  it("renders the result panel when callState has a result", () => {
    renderWithMantine(
      <ToolsScreen
        {...baseProps}
        callState={{
          status: "ok",
          result: { content: [{ type: "text", text: "ok" }] },
        }}
      />,
    );
    expect(screen.getByText("Results")).toBeInTheDocument();
  });

  it("invokes onCallTool with form values on Execute", async () => {
    const user = userEvent.setup();
    const onCallTool = vi.fn();
    renderWithMantine(<ToolsScreen {...baseProps} onCallTool={onCallTool} />);
    await user.click(screen.getByText("alpha"));
    await user.click(screen.getByRole("button", { name: /Execute/ }));
    expect(onCallTool).toHaveBeenCalledWith("alpha", {});
  });

  it("invokes onClearResult when Clear is clicked on the result panel", async () => {
    const user = userEvent.setup();
    const onClearResult = vi.fn();
    renderWithMantine(
      <ToolsScreen
        {...baseProps}
        onClearResult={onClearResult}
        callState={{
          status: "ok",
          result: { content: [{ type: "text", text: "ok" }] },
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClearResult).toHaveBeenCalledTimes(1);
  });

  it("treats pending callState as executing", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ToolsScreen {...baseProps} callState={{ status: "pending" }} />,
    );
    await user.click(screen.getByText("alpha"));
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeInTheDocument();
  });

  it("invokes onCancelCall when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancelCall = vi.fn();
    renderWithMantine(
      <ToolsScreen
        {...baseProps}
        onCancelCall={onCancelCall}
        callState={{ status: "pending" }}
      />,
    );
    await user.click(screen.getByText("alpha"));
    await user.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onCancelCall).toHaveBeenCalledTimes(1);
  });

  it("does not crash when onClearResult/onCancelCall are undefined", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ToolsScreen
        {...baseProps}
        onCancelCall={undefined}
        onClearResult={undefined}
        callState={{
          status: "ok",
          result: { content: [{ type: "text", text: "ok" }] },
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Results")).toBeInTheDocument();
  });
});
