import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { Tool } from "@modelcontextprotocol/client";

// MUST mock ink-scroll-view: the real ScrollView renders a placeholder minimap
// in the non-TTY test env and never mounts its children. This passthrough
// renders children directly and stubs scrollBy/scrollTo/getViewportHeight.
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { ToolsTab } from "../src/components/ToolsTab.js";

// Ink processes stdin keypresses asynchronously — await this after stdin.write
// and after rerender() before asserting.
const tick = async () => {
  // Flush several macrotask cycles so an effect -> setState -> re-render chain
  // settles before assertions, even on slow/loaded CI (a single tick can race).
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};

// Real terminal escape sequences so ink parses them as arrow / page keys.
const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

const makeTool = (over: Partial<Tool> = {}): Tool =>
  ({
    name: "alpha",
    description: "First tool",
    inputSchema: { type: "object", properties: {} },
    ...over,
  }) as unknown as Tool;

// t0: full tool with multi-line description + input schema
// t1: tool with no description and no input schema (absent branches)
// t2: tool with empty name (fallback label + index key)
// t3: trailing tool used for scroll-down coverage
const tools: Tool[] = [
  makeTool({ name: "alpha", description: "Line one\nLine two" }),
  makeTool({
    name: "beta",
    description: undefined,
    inputSchema: undefined,
  } as unknown as Tool),
  makeTool({ name: "", description: "gamma desc" }),
  makeTool({ name: "delta", description: "Delta desc" }),
];

describe("ToolsTab", () => {
  it("renders empty state when there are no tools", () => {
    const { lastFrame } = render(
      <ToolsTab tools={[]} isConnected={false} width={120} height={30} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Tools (0)");
    expect(frame).toContain("No tools available");
    expect(frame).toContain("Select a tool to view details");
  });

  it("renders a populated list with the first tool selected (unfocused)", () => {
    const { lastFrame } = render(
      <ToolsTab tools={tools} isConnected={false} width={120} height={30} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Tools (4)");
    expect(frame).toContain("alpha");
    expect(frame).toContain("beta");
    // empty-name tool falls back to "Tool N"
    expect(frame).toContain("Tool 3");
    expect(frame).toContain("▶ ");
    // selected tool details (cyan branch since not focused on details)
    expect(frame).toContain("Line one");
    expect(frame).toContain("Line two");
    expect(frame).toContain("Input Schema:");
    // not connected → no Enter-to-Test affordance
    expect(frame).not.toContain("[Enter to Test]");
  });

  it("shows the Enter-to-Test affordance when connected", () => {
    const { lastFrame } = render(
      <ToolsTab tools={tools} isConnected={true} width={120} height={30} />,
    );
    expect(lastFrame() ?? "").toContain("[Enter to Test]");
  });

  it("moves selection down/up with arrow keys when the list is focused", async () => {
    const { lastFrame, stdin } = render(
      <ToolsTab
        tools={tools}
        isConnected={false}
        width={120}
        height={30}
        focusedPane="list"
      />,
    );
    // up at the top boundary: no movement
    stdin.write(UP);
    await tick();
    // down moves selection to "beta" and renders its (empty) details
    stdin.write(DOWN);
    await tick();
    let frame = lastFrame() ?? "";
    expect(frame).toContain("beta");
    // beta has no description and no input schema
    expect(frame).not.toContain("Input Schema:");
    // back up to alpha
    stdin.write(UP);
    await tick();
    frame = lastFrame() ?? "";
    expect(frame).toContain("Line one");
  });

  it("scrolls the visible window when navigating past the viewport", async () => {
    // height 9 → visibleCount = 2; 4 tools forces firstVisible to advance
    const { lastFrame, stdin } = render(
      <ToolsTab
        tools={tools}
        isConnected={false}
        width={120}
        height={9}
        focusedPane="list"
      />,
    );
    // Overshoot: the downArrow guard clamps at the last index, so extra
    // presses are harmless and absorb any dropped first keypress.
    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN);
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("delta");
    // down boundary: pressing down again does nothing
    stdin.write(DOWN);
    await tick();
    expect(lastFrame() ?? "").toContain("delta");
  });

  it("calls onTestTool when Enter is pressed while focused and connected", async () => {
    const onTestTool = vi.fn();
    const { stdin } = render(
      <ToolsTab
        tools={tools}
        isConnected={true}
        width={120}
        height={30}
        focusedPane="list"
        onTestTool={onTestTool}
      />,
    );
    stdin.write("\r");
    await tick();
    expect(onTestTool).toHaveBeenCalledWith(tools[0]);
  });

  it("does not fire input handlers when a modal is open", async () => {
    const onTestTool = vi.fn();
    const { stdin } = render(
      <ToolsTab
        tools={tools}
        isConnected={true}
        width={120}
        height={30}
        focusedPane="list"
        onTestTool={onTestTool}
        modalOpen={true}
      />,
    );
    stdin.write("\r");
    await tick();
    expect(onTestTool).not.toHaveBeenCalled();
  });

  it("handles details-pane scrolling, footer, and zoom shortcut", async () => {
    const onViewDetails = vi.fn();
    const { lastFrame, stdin } = render(
      <ToolsTab
        tools={tools}
        isConnected={true}
        width={120}
        height={30}
        focusedPane="details"
        onViewDetails={onViewDetails}
      />,
    );
    // footer only shows while the details pane is focused
    expect(lastFrame() ?? "").toContain("↑/↓ to scroll, + to zoom");
    // scroll keys (exercise scrollBy / pageUp / pageDown branches)
    stdin.write(UP);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();
    // "+" opens the full-screen modal
    stdin.write("+");
    await tick();
    expect(onViewDetails).toHaveBeenCalledWith(tools[0]);
  });
});
