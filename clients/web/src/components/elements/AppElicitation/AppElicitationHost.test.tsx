import { act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/client";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import type { AppElicitationEntry } from "../../../lib/appElicitationController";
import type { BridgeFactory } from "../AppRenderer/AppRenderer";
import {
  APP_ELICITATION_INIT_TIMEOUT_MS,
  AppElicitationHost,
} from "./AppElicitationHost";

const params: ElicitRequest["params"] = {
  message: "Choose an option",
  requestedSchema: {
    type: "object",
    properties: { choice: { type: "string" } },
    required: ["choice"],
  },
};

/**
 * The renderer's bridge, reduced to what this component drives: the app's
 * advertised capabilities and the elicitation round-trip. `emit` lets a test
 * play the view's `initialized` signal, which is what triggers the send.
 */
function createMockBridge(options: {
  elicitation?: boolean;
  answer?: () => Promise<unknown>;
}) {
  const listeners: Record<string, ((payload: unknown) => void)[]> = {};
  const answer =
    options.answer ?? (() => Promise.resolve({ action: "cancel" }));
  const request = vi.fn<(...args: unknown[]) => Promise<unknown>>(() =>
    answer(),
  );
  return {
    bridge: {
      getAppCapabilities: () =>
        options.elicitation === false ? {} : { elicitation: {} },
      request,
      teardownResource: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(
        (event: string, handler: (p: unknown) => void) => {
          (listeners[event] ??= []).push(handler);
        },
      ),
      removeEventListener: vi.fn(),
    } as unknown as AppBridge,
    request,
    emit: (event: string, payload?: unknown) => {
      (listeners[event] ?? []).forEach((h) => h(payload));
    },
  };
}

function makeEntry(
  requestId: string,
  resourceUri = "ui://demo/choose-option.html",
): AppElicitationEntry {
  return {
    requestId,
    sessionId: 0,
    resourceUri,
    params,
    signal: new AbortController().signal,
    resolve: vi.fn(),
    reject: vi.fn(),
  };
}

/** Two microtasks settle the renderer's bridge promise chain (see AppRenderer). */
async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AppElicitationHost (#1854)", () => {
  const onSettle = vi.fn();
  const onFail = vi.fn();

  beforeEach(() => {
    onSettle.mockReset();
    onFail.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing and fails every entry when there is no sandbox", () => {
    renderWithMantine(
      <AppElicitationHost
        entries={[makeEntry("a"), makeEntry("b")]}
        bridgeFactory={vi.fn() as unknown as BridgeFactory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    expect(screen.queryByTestId("app-elicitation")).toBeNull();
    expect(onFail).toHaveBeenCalledTimes(2);
    expect(onFail.mock.calls[0][1].message).toMatch(/sandbox is not available/);
  });

  it("forwards the request through the app's bridge once it is ready and settles with the result", async () => {
    const mock = createMockBridge({
      answer: () =>
        Promise.resolve({ action: "accept", content: { choice: "option-a" } }),
    });
    const factory = vi.fn(() => mock.bridge) as unknown as BridgeFactory;

    renderWithMantine(
      <AppElicitationHost
        entries={[makeEntry("req-1")]}
        sandboxPath="/sandbox.html"
        bridgeFactory={factory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    await flushAsync();
    // Nothing is sent before the view says it is ready — an app that has not
    // completed ui/initialize has no handler registered yet.
    expect(mock.request).not.toHaveBeenCalled();

    await act(async () => {
      mock.emit("initialized");
      await Promise.resolve();
    });

    expect(mock.request.mock.calls[0][0]).toEqual({
      method: "elicitation/create",
      params,
    });
    expect(onSettle).toHaveBeenCalledWith("req-1", {
      action: "accept",
      content: { choice: "option-a" },
    });
    expect(onFail).not.toHaveBeenCalled();
  });

  it("loads the app from the elicitation's own resource URI", async () => {
    const mock = createMockBridge({});
    const factory = vi.fn(() => mock.bridge) as unknown as BridgeFactory;
    renderWithMantine(
      <AppElicitationHost
        entries={[makeEntry("req-1", "ui://demo/other.html")]}
        sandboxPath="/sandbox.html"
        bridgeFactory={factory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    await flushAsync();
    expect(factory).toHaveBeenCalledWith(expect.anything(), {
      kind: "resource",
      resourceUri: "ui://demo/other.html",
      title: params.message,
    });
  });

  it("gives each concurrent request its own frame and bridge", async () => {
    const first = createMockBridge({});
    const second = createMockBridge({});
    const bridges = [first.bridge, second.bridge];
    const factory = vi.fn(() => bridges.shift()) as unknown as BridgeFactory;

    renderWithMantine(
      <AppElicitationHost
        entries={[
          makeEntry("req-1", "ui://demo/first.html"),
          makeEntry("req-2", "ui://demo/second.html"),
        ]}
        sandboxPath="/sandbox.html"
        bridgeFactory={factory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    await flushAsync();
    expect(factory).toHaveBeenCalledTimes(2);

    // Only the second app answers; its result must be attributed to req-2.
    await act(async () => {
      second.emit("initialized");
      await Promise.resolve();
    });
    expect(first.request).not.toHaveBeenCalled();
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle.mock.calls[0][0]).toBe("req-2");
  });

  it("gives the focus trap, Escape and the overlay to the top modal only", async () => {
    // Every entry stays mounted (each app keeps its own bridge and handshake),
    // but only one may own the keyboard — otherwise the traps fight and a
    // single Escape can dismiss more than one pending request.
    const first = createMockBridge({});
    const second = createMockBridge({});
    const bridges = [first.bridge, second.bridge];
    const factory = vi.fn(() => bridges.shift()) as unknown as BridgeFactory;
    const user = userEvent.setup();

    renderWithMantine(
      <AppElicitationHost
        entries={[makeEntry("req-1"), makeEntry("req-2")]}
        sandboxPath="/sandbox.html"
        bridgeFactory={factory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    await flushAsync();
    expect(screen.getAllByTestId("app-elicitation")).toHaveLength(2);

    // The covered dialog is inert: out of the a11y tree and out of focus
    // order, but still mounted — its app keeps its bridge and handshake.
    const [lower, top] = screen.getAllByTestId("app-elicitation");
    expect(lower.hasAttribute("inert")).toBe(true);
    expect(top.hasAttribute("inert")).toBe(false);

    await user.keyboard("{Escape}");
    // Exactly one request is dismissed — the topmost, which is the last one.
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail.mock.calls[0][0]).toBe("req-2");
    expect(onFail.mock.calls[0][1].message).toMatch(/dismissed/);
  });

  it("falls back when the app does not advertise elicitation", async () => {
    const mock = createMockBridge({ elicitation: false });
    renderWithMantine(
      <AppElicitationHost
        entries={[makeEntry("req-1")]}
        sandboxPath="/sandbox.html"
        bridgeFactory={vi.fn(() => mock.bridge) as unknown as BridgeFactory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    await flushAsync();
    await act(async () => {
      mock.emit("initialized");
      await Promise.resolve();
    });
    expect(onSettle).not.toHaveBeenCalled();
    expect(onFail.mock.calls[0][1].message).toMatch(
      /does not support elicitation/,
    );
  });

  it("falls back when the bridge request fails", async () => {
    const mock = createMockBridge({
      answer: () => Promise.reject(new Error("bridge exploded")),
    });
    renderWithMantine(
      <AppElicitationHost
        entries={[makeEntry("req-1")]}
        sandboxPath="/sandbox.html"
        bridgeFactory={vi.fn(() => mock.bridge) as unknown as BridgeFactory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    await flushAsync();
    await act(async () => {
      mock.emit("initialized");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onFail).toHaveBeenCalledWith("req-1", expect.any(Error));
    expect(onFail.mock.calls[0][1].message).toMatch(/bridge exploded/);
  });

  it("wraps a non-Error rejection so the fallback still gets an Error", async () => {
    // The rejection crosses a sandbox boundary; an app or bridge can reject
    // with anything, and `onFail` must still hand the caller an Error.
    const mock = createMockBridge({
      answer: () => Promise.reject("just a string"),
    });
    renderWithMantine(
      <AppElicitationHost
        entries={[makeEntry("req-1")]}
        sandboxPath="/sandbox.html"
        bridgeFactory={vi.fn(() => mock.bridge) as unknown as BridgeFactory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    await flushAsync();
    await act(async () => {
      mock.emit("initialized");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onFail.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(onFail.mock.calls[0][1].message).toBe("just a string");
  });

  it("does not fall back on the init deadline once the request is in flight", async () => {
    // The deadline bounds the HANDSHAKE only. A user taking longer than 15s to
    // answer must not have their app yanked away.
    vi.useFakeTimers();
    let answer: ((result: ElicitResult) => void) | undefined;
    const mock = createMockBridge({
      answer: () => new Promise<ElicitResult>((resolve) => (answer = resolve)),
    });
    renderWithMantine(
      <AppElicitationHost
        entries={[makeEntry("req-1")]}
        sandboxPath="/sandbox.html"
        bridgeFactory={vi.fn(() => mock.bridge) as unknown as BridgeFactory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      mock.emit("initialized");
      await Promise.resolve();
    });
    expect(mock.request).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APP_ELICITATION_INIT_TIMEOUT_MS * 2);
    });
    expect(onFail).not.toHaveBeenCalled();

    await act(async () => {
      answer?.({ action: "accept", content: { choice: "option-a" } });
      await Promise.resolve();
    });
    expect(onSettle).toHaveBeenCalledWith("req-1", {
      action: "accept",
      content: { choice: "option-a" },
    });
  });

  it("falls back when the renderer cannot build a bridge at all", async () => {
    const factory = vi.fn(() => {
      throw new Error("no connected MCP client");
    }) as unknown as BridgeFactory;
    renderWithMantine(
      <AppElicitationHost
        entries={[makeEntry("req-1")]}
        sandboxPath="/sandbox.html"
        bridgeFactory={factory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    await flushAsync();
    expect(onFail).toHaveBeenCalled();
    expect(await screen.findByText(/App failed to render/)).toBeTruthy();
  });

  it("falls back when the app never completes its handshake", async () => {
    vi.useFakeTimers();
    const mock = createMockBridge({});
    renderWithMantine(
      <AppElicitationHost
        entries={[makeEntry("req-1")]}
        sandboxPath="/sandbox.html"
        bridgeFactory={vi.fn(() => mock.bridge) as unknown as BridgeFactory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(APP_ELICITATION_INIT_TIMEOUT_MS + 1);
    });
    expect(mock.request).not.toHaveBeenCalled();
    expect(onFail.mock.calls[0][1].message).toMatch(/did not initialize/);
  });

  it("falls back when the user dismisses the modal", async () => {
    const user = userEvent.setup();
    const mock = createMockBridge({});
    renderWithMantine(
      <AppElicitationHost
        entries={[makeEntry("req-1")]}
        sandboxPath="/sandbox.html"
        bridgeFactory={vi.fn(() => mock.bridge) as unknown as BridgeFactory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    await flushAsync();
    await user.click(
      screen.getByRole("button", { name: /close and use the built-in/i }),
    );
    // Dismissing is not an answer: the server still needs one, so this must be
    // a fallback rather than a fabricated `cancel`.
    expect(onSettle).not.toHaveBeenCalled();
    expect(onFail.mock.calls[0][1].message).toMatch(/dismissed/);
  });

  it("sends only one request even if the view signals ready twice", async () => {
    const mock = createMockBridge({});
    renderWithMantine(
      <AppElicitationHost
        entries={[makeEntry("req-1")]}
        sandboxPath="/sandbox.html"
        bridgeFactory={vi.fn(() => mock.bridge) as unknown as BridgeFactory}
        onSettle={onSettle}
        onFail={onFail}
      />,
    );
    await flushAsync();
    await act(async () => {
      mock.emit("initialized");
      mock.emit("initialized");
      await Promise.resolve();
    });
    expect(mock.request).toHaveBeenCalledTimes(1);
  });

  it("passes decline and cancel through as completed answers", async () => {
    const results: ElicitResult[] = [
      { action: "decline" },
      { action: "cancel" },
    ];
    for (const result of results) {
      onSettle.mockReset();
      const mock = createMockBridge({ answer: () => Promise.resolve(result) });
      const { unmount } = renderWithMantine(
        <AppElicitationHost
          entries={[makeEntry("req-1")]}
          sandboxPath="/sandbox.html"
          bridgeFactory={vi.fn(() => mock.bridge) as unknown as BridgeFactory}
          onSettle={onSettle}
          onFail={onFail}
        />,
      );
      await flushAsync();
      await act(async () => {
        mock.emit("initialized");
        await Promise.resolve();
      });
      expect(onSettle).toHaveBeenCalledWith("req-1", result);
      unmount();
    }
  });
});
