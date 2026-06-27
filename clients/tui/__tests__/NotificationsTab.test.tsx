import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";

// MUST mock ink-scroll-view: the real ScrollView renders a placeholder minimap
// in the non-TTY test env and never mounts its children. This passthrough
// renders children directly and stubs scrollBy/scrollTo/getViewportHeight.
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import type { StderrLogEntry } from "@inspector/core/mcp/index.js";
import { NotificationsTab } from "../src/components/NotificationsTab.js";

// Ink processes stdin keypresses asynchronously — await this after stdin.write
// and after rerender() before asserting.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Real terminal escape sequences (with the leading ESC) so ink reliably parses
// them as arrow / page keys for this component's useInput handler.
const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

const makeLog = (message: string): StderrLogEntry => ({
  timestamp: new Date("2026-06-27T12:34:56Z"),
  message,
});

describe("NotificationsTab", () => {
  it("renders the empty state when there are no logs", () => {
    const { lastFrame } = render(
      <NotificationsTab stderrLogs={[]} width={80} height={20} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Logging (0)");
    expect(frame).toContain("No stderr output yet");
  });

  it("renders log entries with timestamps and messages", () => {
    const logs = [makeLog("first error"), makeLog("second error")];
    const { lastFrame } = render(
      <NotificationsTab stderrLogs={logs} width={80} height={20} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Logging (2)");
    expect(frame).toContain("first error");
    expect(frame).toContain("second error");
    expect(frame).not.toContain("No stderr output yet");
  });

  it("invokes onCountChange with the initial log count", () => {
    const onCountChange = vi.fn();
    render(
      <NotificationsTab
        stderrLogs={[makeLog("a"), makeLog("b")]}
        width={80}
        height={20}
        onCountChange={onCountChange}
      />,
    );
    expect(onCountChange).toHaveBeenCalledWith(2);
  });

  it("re-invokes onCountChange when the log count changes", async () => {
    const onCountChange = vi.fn();
    const { rerender } = render(
      <NotificationsTab
        stderrLogs={[makeLog("a")]}
        width={80}
        height={20}
        onCountChange={onCountChange}
      />,
    );
    expect(onCountChange).toHaveBeenLastCalledWith(1);

    rerender(
      <NotificationsTab
        stderrLogs={[makeLog("a"), makeLog("b"), makeLog("c")]}
        width={80}
        height={20}
        onCountChange={onCountChange}
      />,
    );
    await tick();
    expect(onCountChange).toHaveBeenLastCalledWith(3);
  });

  it("picks up a changed onCountChange callback via the ref effect", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <NotificationsTab
        stderrLogs={[makeLog("a")]}
        width={80}
        height={20}
        onCountChange={first}
      />,
    );
    expect(first).toHaveBeenLastCalledWith(1);

    // New callback identity + new count → the ref is updated, then the
    // count-change effect fires the latest callback.
    rerender(
      <NotificationsTab
        stderrLogs={[makeLog("a"), makeLog("b")]}
        width={80}
        height={20}
        onCountChange={second}
      />,
    );
    await tick();
    expect(second).toHaveBeenLastCalledWith(2);
  });

  it("renders without an onCountChange prop", () => {
    const { lastFrame } = render(
      <NotificationsTab
        stderrLogs={[makeLog("solo")]}
        width={80}
        height={20}
      />,
    );
    expect(lastFrame() ?? "").toContain("solo");
  });

  it("highlights the header and handles scroll keys when focused", async () => {
    const logs = [makeLog("line one"), makeLog("line two")];
    const { lastFrame, stdin } = render(
      <NotificationsTab stderrLogs={logs} width={80} height={20} focused />,
    );
    expect(lastFrame() ?? "").toContain("Logging (2)");

    // Drive every useInput branch
    stdin.write(UP);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();
    stdin.write("x"); // non-handled key → else fall-through
    await tick();

    expect(lastFrame() ?? "").toContain("line one");
  });

  it("handles scroll keys with no logs (ScrollView absent → null scroll ref)", async () => {
    // With an empty log list the ScrollView (and its ref) is never mounted, so
    // scrollViewRef.current is null. Driving the scroll keys exercises the
    // optional-chaining + `getViewportHeight() || 1` fallback paths.
    const { lastFrame, stdin } = render(
      <NotificationsTab stderrLogs={[]} width={80} height={20} focused />,
    );
    expect(lastFrame() ?? "").toContain("No stderr output yet");

    stdin.write(UP);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();

    expect(lastFrame() ?? "").toContain("No stderr output yet");
  });

  it("does not react to keys when not focused", async () => {
    const logs = [makeLog("line one")];
    const { lastFrame, stdin } = render(
      <NotificationsTab stderrLogs={logs} width={80} height={20} />,
    );
    stdin.write(DOWN);
    await tick();
    expect(lastFrame() ?? "").toContain("line one");
  });
});
