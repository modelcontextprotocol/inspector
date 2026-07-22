import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ToolCallErrorPanel } from "./ToolCallErrorPanel";
import { classifyToolCallError } from "./toolResultUtils";

describe("ToolCallErrorPanel", () => {
  it("renders a generic thrown error with the plain title and message", () => {
    renderWithMantine(
      <ToolCallErrorPanel error="Internal error" onClear={vi.fn()} />,
    );
    expect(screen.getByText("Tool Call Failed")).toBeInTheDocument();
    expect(screen.getByText("Tool Error")).toBeInTheDocument();
    expect(screen.getByText("Internal error")).toBeInTheDocument();
    // No -32602 hints for a generic error.
    expect(screen.queryByText(/does not recognize this tool/)).toBeNull();
    expect(screen.queryByText(/against the tool/)).toBeNull();
  });

  it("renders the unknown-tool heading + hint when the message names it (#1632)", () => {
    renderWithMantine(
      <ToolCallErrorPanel
        error="MCP error -32602: Tool echo not found"
        errorCode={-32602}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("Unknown Tool")).toBeInTheDocument();
    expect(
      screen.getByText(/does not recognize this tool/),
    ).toBeInTheDocument();
  });

  it("renders Invalid Parameters for a -32602 that is NOT an unknown tool (#1632)", () => {
    // Same code, but the message is about bad arguments for a known tool — must
    // not be mislabelled "Unknown Tool".
    renderWithMantine(
      <ToolCallErrorPanel
        error="MCP error -32602: Invalid params: 'count' must be a number"
        errorCode={-32602}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("Invalid Parameters")).toBeInTheDocument();
    expect(screen.getByText(/against the tool/)).toBeInTheDocument();
    expect(screen.queryByText(/does not recognize this tool/)).toBeNull();
  });

  it("invokes onClear when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderWithMantine(<ToolCallErrorPanel error="boom" onClear={onClear} />);
    await user.click(screen.getByRole("button", { name: "Close error" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("classifyToolCallError narrows -32602 by message", () => {
    expect(classifyToolCallError(-32602, "Tool foo not found")).toBe(
      "unknown-tool",
    );
    expect(classifyToolCallError(-32602, "unknown tool: foo")).toBe(
      "unknown-tool",
    );
    // -32602 without an unknown-tool marker → invalid params, not unknown tool.
    expect(classifyToolCallError(-32602, "bad argument type")).toBe(
      "invalid-params",
    );
    expect(classifyToolCallError(-32602)).toBe("invalid-params");
    // Any other code (or none) is generic.
    expect(classifyToolCallError(-32601, "Tool not found")).toBe("generic");
    expect(classifyToolCallError(undefined)).toBe("generic");
  });
});
