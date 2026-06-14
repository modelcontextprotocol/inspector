import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  renderWithMantine,
  screen,
  waitFor,
} from "../../../test/renderWithMantine";
import { ToolResultPanel } from "./ToolResultPanel";

const okResult: CallToolResult = {
  content: [{ type: "text", text: "ok" }],
  isError: false,
};

const errorResult: CallToolResult = {
  content: [{ type: "text", text: "boom" }],
  isError: true,
};

const emptyResult: CallToolResult = { content: [] };

describe("ToolResultPanel", () => {
  it("renders text content blocks", () => {
    renderWithMantine(<ToolResultPanel result={okResult} onClear={() => {}} />);
    expect(screen.getByText("ok")).toBeInTheDocument();
  });

  it("renders an error alert when isError is true", () => {
    renderWithMantine(
      <ToolResultPanel result={errorResult} onClear={() => {}} />,
    );
    expect(screen.getByText("Tool Error")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("renders the empty state when content is empty", () => {
    renderWithMantine(
      <ToolResultPanel result={emptyResult} onClear={() => {}} />,
    );
    expect(screen.getByText("No results yet")).toBeInTheDocument();
  });

  it("renders a resource_link block as an expandable ResourceLink", async () => {
    const user = userEvent.setup();
    const onReadResource = vi.fn().mockResolvedValue({
      contents: [{ uri: "demo://r/1", text: "linked body" }],
    });
    const result: CallToolResult = {
      content: [
        { type: "text", text: "ok" },
        { type: "resource_link", uri: "demo://r/1", name: "Linked" },
      ],
    };
    renderWithMantine(
      <ToolResultPanel
        result={result}
        onClear={() => {}}
        onReadResource={onReadResource}
      />,
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Expand resource demo://r/1" }),
    );
    expect(onReadResource).toHaveBeenCalledWith("demo://r/1");
    await waitFor(() =>
      expect(screen.getByText(/"linked body"/)).toBeInTheDocument(),
    );
  });

  it("invokes onClear when Clear is clicked", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderWithMantine(<ToolResultPanel result={okResult} onClear={onClear} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
