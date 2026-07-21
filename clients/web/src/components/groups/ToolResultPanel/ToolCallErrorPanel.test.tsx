import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ToolCallErrorPanel } from "./ToolCallErrorPanel";
import { isUnknownToolError } from "./toolResultUtils";

describe("ToolCallErrorPanel", () => {
  it("renders a generic thrown error with the plain title and message", () => {
    renderWithMantine(
      <ToolCallErrorPanel error="Internal error" onClear={vi.fn()} />,
    );
    expect(screen.getByText("Tool Call Failed")).toBeInTheDocument();
    expect(screen.getByText("Tool Error")).toBeInTheDocument();
    expect(screen.getByText("Internal error")).toBeInTheDocument();
    // No unknown-tool hint for a generic error.
    expect(screen.queryByText(/does not recognize this tool/)).toBeNull();
  });

  it("renders the unknown-tool hint for a -32602 rejection (#1632)", () => {
    renderWithMantine(
      <ToolCallErrorPanel
        error="MCP error -32602: Invalid params"
        errorCode={-32602}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("Unknown Tool")).toBeInTheDocument();
    expect(
      screen.getByText(/does not recognize this tool/),
    ).toBeInTheDocument();
  });

  it("invokes onClear when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderWithMantine(<ToolCallErrorPanel error="boom" onClear={onClear} />);
    await user.click(screen.getByRole("button", { name: "Close error" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("isUnknownToolError classifies only -32602", () => {
    expect(isUnknownToolError(-32602)).toBe(true);
    expect(isUnknownToolError(-32601)).toBe(false);
    expect(isUnknownToolError(undefined)).toBe(false);
  });
});
