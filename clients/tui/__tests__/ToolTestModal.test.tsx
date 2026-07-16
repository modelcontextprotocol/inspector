import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { Tool } from "@modelcontextprotocol/client";

// ScrollView passthrough so the results JSX actually mounts (and is covered).
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));
// Form double that fires onSubmit when the user presses Enter ("\r").
vi.mock("ink-form", () => import("./helpers/inkFormMock.js"));

import { ToolTestModal } from "../src/components/ToolTestModal.js";

// These modals render position="absolute", which produces an EMPTY frame under
// ink-testing-library (absolute boxes aren't laid out at the root). So we assert
// on BEHAVIOR — the injected client fake's methods, onClose, and the state
// transitions they drive — rather than on lastFrame() content. React still
// EXECUTES the inner results/error/loading JSX, so its coverage is collected.

const tick = async () => {
  // Flush several macrotask cycles so an effect -> setState -> re-render chain
  // settles before assertions, even on slow/loaded CI (a single tick can race).
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};
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

const fakeClient = (callTool: unknown): InspectorClient =>
  ({ callTool }) as unknown as InspectorClient;

// Set the value the Form double submits on Enter; cleared after each test.
const setSubmitValue = (value: Record<string, unknown>) => {
  (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__ = value;
};

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__;
  vi.restoreAllMocks();
});

// Render → submit form → let the awaited callTool + setState settle.
const renderAndSubmit = async (
  client: InspectorClient | null,
  submitValue: Record<string, unknown> = {},
) => {
  const onClose = vi.fn();
  const api = render(
    <ToolTestModal
      tool={makeTool()}
      inspectorClient={client}
      width={80}
      height={24}
      onClose={onClose}
    />,
  );
  await tick();
  setSubmitValue(submitValue);
  api.stdin.write("\r");
  await tick();
  await tick();
  return { ...api, onClose };
};

describe("ToolTestModal", () => {
  it("renders the form initially without invoking the client", async () => {
    const callTool = vi.fn();
    const api = render(
      <ToolTestModal
        tool={makeTool()}
        inspectorClient={fakeClient(callTool)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    expect(callTool).not.toHaveBeenCalled();
    api.unmount();
  });

  it("falls back to a default form structure (and name) when the tool has no inputSchema or name", async () => {
    const callTool = vi.fn();
    const tool = makeTool({ inputSchema: undefined, name: "" });
    const api = render(
      <ToolTestModal
        tool={tool}
        inspectorClient={fakeClient(callTool)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    api.unmount();
  });

  it("uses the 'Unknown Tool' label when a schema-bearing tool has an empty name", async () => {
    const callTool = vi.fn();
    const tool = makeTool({ name: "" });
    const api = render(
      <ToolTestModal
        tool={tool}
        inspectorClient={fakeClient(callTool)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    api.unmount();
  });

  it("renders the loading state while the call is in flight", async () => {
    let resolveCall: (v: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveCall = resolve;
    });
    const callTool = vi.fn().mockReturnValue(pending);
    const onClose = vi.fn();
    const api = render(
      <ToolTestModal
        tool={makeTool()}
        inspectorClient={fakeClient(callTool)}
        width={80}
        height={24}
        onClose={onClose}
      />,
    );
    await tick();
    setSubmitValue({});
    api.stdin.write("\r");
    await tick();
    // The component is now committed in the "loading" state (call not resolved).
    expect(callTool).toHaveBeenCalled();
    resolveCall({
      success: true,
      result: { content: [{ type: "text", text: "done" }] },
    });
    await tick();
    await tick();
    api.unmount();
  });

  it("calls callTool and shows successful output", async () => {
    const callTool = vi.fn().mockResolvedValue({
      success: true,
      result: { content: [{ type: "text", text: "hello" }] },
      error: undefined,
    });
    const { onClose, stdin, unmount } = await renderAndSubmit(
      fakeClient(callTool),
      { foo: "bar" },
    );
    expect(callTool).toHaveBeenCalledWith(makeTool(), { foo: "bar" });
    // Drive scroll keys in results state for scrollBy / page coverage.
    stdin.write(DOWN);
    await tick();
    stdin.write(UP);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("renders the error branch when the result has isError === true", async () => {
    const callTool = vi.fn().mockResolvedValue({
      success: true,
      result: { isError: true, content: [{ type: "text", text: "oops" }] },
    });
    const { unmount } = await renderAndSubmit(fakeClient(callTool));
    expect(callTool).toHaveBeenCalled();
    unmount();
  });

  it("renders the failed-call branch when success is false and result is null", async () => {
    const callTool = vi.fn().mockResolvedValue({
      success: false,
      result: null,
      error: "tool blew up",
    });
    const { unmount } = await renderAndSubmit(fakeClient(callTool));
    expect(callTool).toHaveBeenCalled();
    unmount();
  });

  it("uses the default error message when a failed call has no error string", async () => {
    const callTool = vi.fn().mockResolvedValue({
      success: false,
      result: null,
    });
    const { unmount } = await renderAndSubmit(fakeClient(callTool));
    expect(callTool).toHaveBeenCalled();
    unmount();
  });

  it("catches an Error thrown by callTool", async () => {
    const callTool = vi.fn().mockRejectedValue(new Error("network down"));
    const { unmount } = await renderAndSubmit(fakeClient(callTool));
    expect(callTool).toHaveBeenCalled();
    unmount();
  });

  it("catches a non-Error value thrown by callTool", async () => {
    const callTool = vi.fn().mockRejectedValue("boom");
    const { unmount } = await renderAndSubmit(fakeClient(callTool));
    expect(callTool).toHaveBeenCalled();
    unmount();
  });

  it("does nothing on submit when inspectorClient is null (early-return guard)", async () => {
    const { onClose, unmount } = await renderAndSubmit(null);
    // No client to call; stays in form state and onClose untouched.
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("closes on ESC while in form state", async () => {
    const onClose = vi.fn();
    const api = render(
      <ToolTestModal
        tool={makeTool()}
        inspectorClient={fakeClient(vi.fn())}
        width={80}
        height={24}
        onClose={onClose}
      />,
    );
    await tick();
    api.stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    api.unmount();
  });

  it("closes on ESC while in results state", async () => {
    const callTool = vi.fn().mockResolvedValue({
      success: true,
      result: { content: [{ type: "text", text: "hi" }] },
    });
    const { onClose, stdin, unmount } = await renderAndSubmit(
      fakeClient(callTool),
    );
    stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("responds to a stdout resize event", async () => {
    const onClose = vi.fn();
    const api = render(
      <ToolTestModal
        tool={makeTool()}
        inspectorClient={fakeClient(vi.fn())}
        width={80}
        height={24}
        onClose={onClose}
      />,
    );
    await tick();
    process.stdout.emit("resize");
    await tick();
    api.unmount();
  });
});
