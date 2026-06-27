import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

// MUST mock ink-scroll-view: the real ScrollView renders a placeholder minimap
// in the non-TTY test env and never mounts its children. This passthrough
// renders children directly and stubs scrollBy/scrollTo/getViewportHeight.
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { PromptsTab } from "../src/components/PromptsTab.js";

// Ink processes stdin keypresses asynchronously — await this after stdin.write
// and after rerender() before asserting. The longer delay also lets the async
// getPrompt IIFE + setState settle.
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

const makePrompt = (over: Partial<Prompt> = {}): Prompt =>
  ({
    name: "alpha",
    description: "First prompt",
    ...over,
  }) as unknown as Prompt;

// p0: full prompt with multi-line description + three argument variants
//     (description present / `type` fallback / "string" fallback)
// p1: prompt with no description and no arguments (absent branches)
// p2: empty name → "Prompt N" fallback label + index key
// p3: trailing prompt for scroll-window coverage
const prompts: Prompt[] = [
  makePrompt({
    name: "alpha",
    description: "Line one\nLine two",
    arguments: [
      { name: "withDesc", description: "the description" },
      { name: "withType", type: "number" } as never,
      { name: "bare" },
    ],
  }),
  makePrompt({ name: "beta", description: undefined, arguments: undefined }),
  makePrompt({ name: "", description: "gamma desc" }),
  makePrompt({ name: "delta", description: "Delta desc" }),
];

describe("PromptsTab", () => {
  it("renders empty state when there are no prompts", () => {
    const { lastFrame } = render(
      <PromptsTab
        prompts={[]}
        inspectorClient={null}
        width={120}
        height={30}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Prompts (0)");
    expect(frame).toContain("No prompts available");
    expect(frame).toContain("Select a prompt to view details");
  });

  it("renders a populated list with the first prompt selected (unfocused)", () => {
    const { lastFrame } = render(
      <PromptsTab
        prompts={prompts}
        inspectorClient={null}
        width={120}
        height={30}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Prompts (4)");
    expect(frame).toContain("alpha");
    expect(frame).toContain("beta");
    // empty-name prompt falls back to "Prompt N"
    expect(frame).toContain("Prompt 3");
    expect(frame).toContain("▶ ");
    // selected prompt details (cyan branch since details not focused)
    expect(frame).toContain("Line one");
    expect(frame).toContain("Line two");
    // arguments + their three description fallbacks
    expect(frame).toContain("Arguments:");
    expect(frame).toContain("the description");
    expect(frame).toContain("number");
    expect(frame).toContain("bare: string");
    expect(frame).toContain("[Enter to Get Prompt]");
  });

  it("moves selection down/up with arrow keys when the list is focused", async () => {
    const { lastFrame, stdin } = render(
      <PromptsTab
        prompts={prompts}
        inspectorClient={null}
        width={120}
        height={30}
        focusedPane="list"
      />,
    );
    // up at the top boundary: no movement
    stdin.write(UP);
    await tick();
    // down moves selection to "beta" (no description, no arguments)
    stdin.write(DOWN);
    await tick();
    let frame = lastFrame() ?? "";
    expect(frame).toContain("beta");
    expect(frame).not.toContain("Arguments:");
    // back up to alpha
    stdin.write(UP);
    await tick();
    frame = lastFrame() ?? "";
    expect(frame).toContain("Line one");
  });

  it("scrolls the visible window when navigating past the viewport", async () => {
    // height 9 → visibleCount = 2; 4 prompts force firstVisible to advance
    const { lastFrame, stdin } = render(
      <PromptsTab
        prompts={prompts}
        inspectorClient={null}
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

  it("calls onFetchPrompt when Enter is pressed on a prompt with arguments", async () => {
    const onFetchPrompt = vi.fn();
    const inspectorClient = {
      getPrompt: vi.fn(),
    } as unknown as InspectorClient;
    const { stdin } = render(
      <PromptsTab
        prompts={prompts}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="list"
        onFetchPrompt={onFetchPrompt}
      />,
    );
    stdin.write("\r");
    await tick();
    expect(onFetchPrompt).toHaveBeenCalledWith(prompts[0]);
  });

  it("fetches directly and calls onViewDetails when Enter is pressed on an argument-less prompt", async () => {
    const onFetchPrompt = vi.fn();
    const onViewDetails = vi.fn();
    const result = { messages: [] };
    const getPrompt = vi.fn().mockResolvedValue({ result });
    const inspectorClient = { getPrompt } as unknown as InspectorClient;
    const noArgPrompt = makePrompt({ name: "solo", arguments: undefined });
    const { stdin } = render(
      <PromptsTab
        prompts={[noArgPrompt]}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="list"
        onFetchPrompt={onFetchPrompt}
        onViewDetails={onViewDetails}
      />,
    );
    stdin.write("\r");
    await tick();
    expect(getPrompt).toHaveBeenCalledWith("solo");
    expect(onFetchPrompt).not.toHaveBeenCalled();
    expect(onViewDetails).toHaveBeenCalledWith(
      expect.objectContaining({ name: "solo", result }),
    );
  });

  it("renders the Error message when getPrompt rejects with an Error", async () => {
    const getPrompt = vi.fn().mockRejectedValue(new Error("boom failure"));
    const inspectorClient = { getPrompt } as unknown as InspectorClient;
    const noArgPrompt = makePrompt({ name: "solo", arguments: undefined });
    const { lastFrame, stdin } = render(
      <PromptsTab
        prompts={[noArgPrompt]}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="list"
        onFetchPrompt={vi.fn()}
        onViewDetails={vi.fn()}
      />,
    );
    stdin.write("\r");
    await tick();
    expect(lastFrame() ?? "").toContain("boom failure");
  });

  it("falls back to a generic Error message when getPrompt rejects with a non-Error", async () => {
    const getPrompt = vi.fn().mockRejectedValue("oops");
    const inspectorClient = { getPrompt } as unknown as InspectorClient;
    const noArgPrompt = makePrompt({ name: "solo", arguments: undefined });
    const { lastFrame, stdin } = render(
      <PromptsTab
        prompts={[noArgPrompt]}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="list"
        onFetchPrompt={vi.fn()}
        onViewDetails={vi.fn()}
      />,
    );
    stdin.write("\r");
    await tick();
    expect(lastFrame() ?? "").toContain("Failed to get prompt");
  });

  it("handles details-pane scrolling, footer, and zoom shortcut", async () => {
    const onViewDetails = vi.fn();
    const { lastFrame, stdin } = render(
      <PromptsTab
        prompts={prompts}
        inspectorClient={null}
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
    expect(onViewDetails).toHaveBeenCalledWith(prompts[0]);
  });

  it("does not fire input handlers when a modal is open", async () => {
    const onFetchPrompt = vi.fn();
    const inspectorClient = {
      getPrompt: vi.fn(),
    } as unknown as InspectorClient;
    const { stdin } = render(
      <PromptsTab
        prompts={prompts}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        focusedPane="list"
        onFetchPrompt={onFetchPrompt}
        modalOpen={true}
      />,
    );
    stdin.write("\r");
    await tick();
    expect(onFetchPrompt).not.toHaveBeenCalled();
  });
});
