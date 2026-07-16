import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { CallToolResult } from "@modelcontextprotocol/client";
import {
  renderWithMantine,
  screen,
  waitFor,
} from "../../../test/renderWithMantine";
import { ToolResultPanel } from "./ToolResultPanel";
import { resultHasResourceLinks } from "./toolResultUtils";

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

  it("groups resource_link blocks in a scrollable Resource Links box", async () => {
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
    // The link sits inside a grouped, labeled box.
    expect(
      screen.getByRole("heading", { name: "Resource Links" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Expand resource demo://r/1" }),
    );
    expect(onReadResource).toHaveBeenCalledWith("demo://r/1");
    await waitFor(() =>
      expect(screen.getByText(/"linked body"/)).toBeInTheDocument(),
    );
  });

  it("collapses consecutive resource_link blocks into a single box", () => {
    const result: CallToolResult = {
      content: [
        { type: "text", text: "intro" },
        { type: "resource_link", uri: "demo://r/1", name: "One" },
        { type: "resource_link", uri: "demo://r/2", name: "Two" },
        { type: "resource_link", uri: "demo://r/3", name: "Three" },
      ],
    };
    renderWithMantine(<ToolResultPanel result={result} onClear={() => {}} />);
    // One shared "Resource Links" heading for the whole run of links.
    expect(
      screen.getAllByRole("heading", { name: "Resource Links" }),
    ).toHaveLength(1);
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
    expect(screen.getByText("Three")).toBeInTheDocument();
  });

  it("renders a separate Resource Links box per non-adjacent run", () => {
    const result: CallToolResult = {
      content: [
        { type: "resource_link", uri: "demo://r/1", name: "One" },
        { type: "text", text: "divider" },
        { type: "resource_link", uri: "demo://r/2", name: "Two" },
      ],
    };
    renderWithMantine(<ToolResultPanel result={result} onClear={() => {}} />);
    // The text block between the two links splits them into two boxes.
    expect(
      screen.getAllByRole("heading", { name: "Resource Links" }),
    ).toHaveLength(2);
    expect(screen.getByText("divider")).toBeInTheDocument();
  });

  it("invokes onClear when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderWithMantine(<ToolResultPanel result={okResult} onClear={onClear} />);
    await user.click(screen.getByRole("button", { name: "Close results" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  describe("resultHasResourceLinks", () => {
    it("is true only for a non-error result containing a resource_link", () => {
      expect(
        resultHasResourceLinks({
          content: [
            { type: "text", text: "ok" },
            { type: "resource_link", uri: "demo://r/1", name: "Linked" },
          ],
        }),
      ).toBe(true);
    });

    it("is false for a text-only result", () => {
      expect(resultHasResourceLinks(okResult)).toBe(false);
    });

    it("is false for an empty result", () => {
      expect(resultHasResourceLinks(emptyResult)).toBe(false);
    });

    it("is false when the result is an error, even with a resource_link", () => {
      expect(
        resultHasResourceLinks({
          isError: true,
          content: [
            { type: "resource_link", uri: "demo://r/1", name: "Linked" },
          ],
        }),
      ).toBe(false);
    });
  });
});
