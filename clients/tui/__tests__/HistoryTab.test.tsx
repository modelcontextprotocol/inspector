import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { MessageEntry } from "@inspector/core/mcp/index.js";

// MUST mock ink-scroll-view: the real ScrollView renders a placeholder minimap
// in the non-TTY test env and never mounts its children. This passthrough
// renders children directly and stubs scrollBy/scrollTo/getViewportHeight.
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { HistoryTab } from "../src/components/HistoryTab.js";

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

const ts = new Date("2024-01-01T12:34:56Z");

const entry = (over: Partial<MessageEntry>): MessageEntry =>
  ({
    id: "id",
    timestamp: ts,
    direction: "request",
    message: { jsonrpc: "2.0", id: 1, method: "ping" },
    ...over,
  }) as unknown as MessageEntry;

// One entry exercising each label / direction / detail branch.
const reqWithResponse = entry({
  id: "m0",
  direction: "request",
  message: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  response: { jsonrpc: "2.0", id: 1, result: { tools: [] } },
  duration: 5,
});
const reqPending = entry({
  id: "m1",
  direction: "request",
  message: { jsonrpc: "2.0", id: 2, method: "tools/call" },
});
const respResult = entry({
  id: "m2",
  direction: "response",
  message: { jsonrpc: "2.0", id: 3, result: { ok: true } },
});
const respError = entry({
  id: "m3",
  direction: "response",
  message: { jsonrpc: "2.0", id: 4, error: { code: -32601, message: "no" } },
});
const respPlain = entry({
  id: "m4",
  direction: "response",
  message: { jsonrpc: "2.0", id: 5 },
});
const notification = entry({
  id: "m5",
  direction: "notification",
  message: { jsonrpc: "2.0", method: "notifications/message" },
});
const unknownEntry = entry({
  id: "m6",
  direction: "notification",
  message: { jsonrpc: "2.0" },
});

const allMessages: MessageEntry[] = [
  reqWithResponse,
  reqPending,
  respResult,
  respError,
  respPlain,
  notification,
  unknownEntry,
];

describe("HistoryTab", () => {
  it("renders the empty state when there are no messages", () => {
    const onCountChange = vi.fn();
    const { lastFrame } = render(
      <HistoryTab
        serverName="srv"
        messages={[]}
        width={120}
        height={30}
        onCountChange={onCountChange}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Messages (0)");
    expect(frame).toContain("No messages");
    expect(frame).toContain("Select a message to view details");
    expect(onCountChange).toHaveBeenCalledWith(0);
  });

  it("renders every list-label and direction-symbol variant", () => {
    const { lastFrame } = render(
      <HistoryTab
        serverName="srv"
        messages={allMessages}
        width={120}
        height={40}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Messages (7)");
    // request with response → "✓"; pending request → "..."
    expect(frame).toContain("→ tools/list ✓");
    expect(frame).toContain("→ tools/call ...");
    // response labels
    expect(frame).toContain("← Response (result)");
    expect(frame).toContain("← Response (error: -32601)");
    expect(frame).toContain("← Response");
    // notification + unknown
    expect(frame).toContain("• notifications/message");
    expect(frame).toContain("• Unknown");
    expect(frame).toContain("▶ ");
  });

  it("renders request details with a response section and duration", () => {
    const { lastFrame } = render(
      <HistoryTab
        serverName="srv"
        messages={[reqWithResponse]}
        width={120}
        height={40}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Direction: request");
    expect(frame).toContain("(5ms)");
    expect(frame).toContain("Request:");
    expect(frame).toContain("Response:");
  });

  it("renders the waiting-for-response placeholder for a pending request", () => {
    const { lastFrame } = render(
      <HistoryTab
        serverName="srv"
        messages={[reqPending]}
        width={120}
        height={40}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Request:");
    expect(frame).toContain("Waiting for response...");
  });

  it("renders response details with a Response label and Response header", () => {
    const { lastFrame } = render(
      <HistoryTab
        serverName="srv"
        messages={[respResult]}
        width={120}
        height={40}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Direction: response");
    expect(frame).toContain("Response:");
  });

  it("renders notification details with a Notification label", () => {
    const { lastFrame } = render(
      <HistoryTab
        serverName="srv"
        messages={[notification]}
        width={120}
        height={40}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Direction: notification");
    expect(frame).toContain("Notification:");
    // header uses the notification method
    expect(frame).toContain("notifications/message");
  });

  it("falls back to the Message header for a methodless notification", () => {
    const { lastFrame } = render(
      <HistoryTab
        serverName="srv"
        messages={[unknownEntry]}
        width={120}
        height={40}
      />,
    );
    expect(lastFrame() ?? "").toContain("Message");
  });

  it("moves selection with arrows and page keys when the list is focused", async () => {
    const { lastFrame, stdin } = render(
      <HistoryTab
        serverName="srv"
        messages={allMessages}
        width={120}
        height={12}
        focusedPane="messages"
      />,
    );
    // up at top boundary: no movement
    stdin.write(UP);
    await tick();
    // down to the next message
    stdin.write(DOWN);
    await tick();
    expect(lastFrame() ?? "").toContain("Direction: request");
    // pageDown jumps toward the end, pageUp back toward the start
    stdin.write(PAGE_DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
    // up to move back toward the top
    stdin.write(UP);
    await tick();
    expect(lastFrame() ?? "").toContain("Messages (7)");
  });

  it("handles details-pane scrolling, footer, and zoom shortcut", async () => {
    const onViewDetails = vi.fn();
    const { lastFrame, stdin } = render(
      <HistoryTab
        serverName="srv"
        messages={allMessages}
        width={120}
        height={40}
        focusedPane="details"
        onViewDetails={onViewDetails}
      />,
    );
    expect(lastFrame() ?? "").toContain("↑/↓ to scroll, + to zoom");
    stdin.write(UP);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();
    stdin.write("+");
    await tick();
    expect(onViewDetails).toHaveBeenCalledWith(allMessages[0]);
  });

  it("does not fire input handlers when a modal is open", async () => {
    const onViewDetails = vi.fn();
    const { stdin } = render(
      <HistoryTab
        serverName="srv"
        messages={allMessages}
        width={120}
        height={40}
        focusedPane="details"
        onViewDetails={onViewDetails}
        modalOpen={true}
      />,
    );
    stdin.write("+");
    await tick();
    expect(onViewDetails).not.toHaveBeenCalled();
  });
});
