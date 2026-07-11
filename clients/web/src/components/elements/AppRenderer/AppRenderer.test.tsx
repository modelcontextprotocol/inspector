import { createRef, StrictMode } from "react";
import { act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  AppRenderer,
  type AppRendererHandle,
  type BridgeFactory,
} from "./AppRenderer";

const tool: Tool = {
  name: "cohort_app",
  title: "Cohort App",
  inputSchema: { type: "object" },
};

interface MockBridge {
  sendToolInput: ReturnType<typeof vi.fn>;
  sendToolInputPartial: ReturnType<typeof vi.fn>;
  sendToolResult: ReturnType<typeof vi.fn>;
  sendToolCancelled: ReturnType<typeof vi.fn>;
  sendHostContextChange: ReturnType<typeof vi.fn>;
  teardownResource: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  onrequestdisplaymode?: (params: {
    mode: "inline" | "fullscreen" | "pip";
  }) => Promise<{ mode: "inline" | "fullscreen" | "pip" }>;
  onmessage?: (params: {
    role: "user";
    content: unknown[];
  }) => Promise<Record<string, unknown>>;
  /** Test helper: dispatch a bridge event (e.g. "initialized") to listeners. */
  emit: (event: string, payload?: unknown) => void;
}

function createMockBridge(): MockBridge {
  const listeners: Record<string, ((payload: unknown) => void)[]> = {};
  return {
    sendToolInput: vi.fn().mockResolvedValue(undefined),
    sendToolInputPartial: vi.fn().mockResolvedValue(undefined),
    sendToolResult: vi.fn().mockResolvedValue(undefined),
    sendToolCancelled: vi.fn().mockResolvedValue(undefined),
    sendHostContextChange: vi.fn().mockResolvedValue(undefined),
    teardownResource: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((event: string, handler: (p: unknown) => void) => {
      (listeners[event] ??= []).push(handler);
    }),
    removeEventListener: vi.fn(
      (event: string, handler: (p: unknown) => void) => {
        listeners[event] = (listeners[event] ?? []).filter(
          (h) => h !== handler,
        );
      },
    ),
    emit: (event: string, payload?: unknown) => {
      (listeners[event] ?? []).forEach((h) => h(payload));
    },
  };
}

function asBridge(mock: MockBridge): AppBridge {
  return mock as unknown as AppBridge;
}

// Two microtask ticks are enough to settle the bridge promise chain in the
// component when the factory is synchronous: tick 1 resolves
// `Promise.resolve(bridgeFactory(iframe))`, tick 2 runs the `.then` that
// assigns `bridgeRef.current`. Tests using a multi-hop async factory must
// flush further inline (see the post-unmount disposal cases).
async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AppRenderer", () => {
  it("renders an iframe with the sandbox path and tool title", () => {
    const bridge = createMockBridge();
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    const iframe = screen.getByTitle("Cohort App") as HTMLIFrameElement;
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.getAttribute("src")).toBe("/sandbox.html");
  });

  it("falls back to tool name when title is missing", () => {
    const bridge = createMockBridge();
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={{ name: "no_title", inputSchema: { type: "object" } }}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    expect(screen.getByTitle("no_title")).toBeInTheDocument();
  });

  it("invokes the bridge factory with the iframe element", async () => {
    const bridge = createMockBridge();
    const factory = vi.fn<BridgeFactory>(() => asBridge(bridge));
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
      />,
    );
    await flushAsync();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]?.[0]).toBeInstanceOf(HTMLIFrameElement);
    expect(factory.mock.calls[0]?.[1]).toBe(tool);
  });

  it("forwards sendToolInput through the bridge once initialized", async () => {
    const bridge = createMockBridge();
    const ref = createRef<AppRendererHandle>();
    renderWithMantine(
      <AppRenderer
        ref={ref}
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await act(async () => {
      await ref.current?.sendToolInput({ city: "NYC" });
      bridge.emit("initialized");
    });
    expect(bridge.sendToolInput).toHaveBeenCalledWith({
      arguments: { city: "NYC" },
    });
  });

  it("forwards sendToolResult through the bridge once initialized", async () => {
    const bridge = createMockBridge();
    const ref = createRef<AppRendererHandle>();
    const result: CallToolResult = {
      content: [{ type: "text", text: "ok" }],
    };
    renderWithMantine(
      <AppRenderer
        ref={ref}
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await act(async () => {
      await ref.current?.sendToolResult(result);
      bridge.emit("initialized");
    });
    expect(bridge.sendToolResult).toHaveBeenCalledWith(result);
  });

  it("buffers tool input until the view is initialized, then flushes input before result", async () => {
    const bridge = createMockBridge();
    const ref = createRef<AppRendererHandle>();
    const result: CallToolResult = { content: [{ type: "text", text: "ok" }] };
    renderWithMantine(
      <AppRenderer
        ref={ref}
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();

    // Pushed before `initialized` — must not reach the bridge yet.
    await act(async () => {
      await ref.current?.sendToolInput({ city: "NYC" });
      await ref.current?.sendToolResult(result);
    });
    expect(bridge.sendToolInput).not.toHaveBeenCalled();
    expect(bridge.sendToolResult).not.toHaveBeenCalled();

    // Initialization releases both, input first.
    await act(async () => {
      bridge.emit("initialized");
    });
    expect(bridge.sendToolInput).toHaveBeenCalledTimes(1);
    expect(bridge.sendToolResult).toHaveBeenCalledTimes(1);
    expect(bridge.sendToolInput.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.sendToolResult.mock.invocationCallOrder[0],
    );
  });

  it("keeps only the latest buffered input (latest-wins)", async () => {
    const bridge = createMockBridge();
    const ref = createRef<AppRendererHandle>();
    renderWithMantine(
      <AppRenderer
        ref={ref}
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await act(async () => {
      await ref.current?.sendToolInput({ city: "NYC" });
      await ref.current?.sendToolInput({ city: "LA" });
      bridge.emit("initialized");
    });
    expect(bridge.sendToolInput).toHaveBeenCalledTimes(1);
    expect(bridge.sendToolInput).toHaveBeenCalledWith({
      arguments: { city: "LA" },
    });
  });

  it("forwards sendToolCancelled through the bridge", async () => {
    const bridge = createMockBridge();
    const ref = createRef<AppRendererHandle>();
    renderWithMantine(
      <AppRenderer
        ref={ref}
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await act(async () => {
      await ref.current?.sendToolCancelled("user-aborted");
    });
    expect(bridge.sendToolCancelled).toHaveBeenCalledWith({
      reason: "user-aborted",
    });
  });

  it("forwards view size-changed notifications to onSizeChange", async () => {
    const bridge = createMockBridge();
    const onSizeChange = vi.fn();
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
        onSizeChange={onSizeChange}
      />,
    );
    await flushAsync();
    await act(async () => {
      bridge.emit("sizechange", { width: 480, height: 600 });
    });
    expect(onSizeChange).toHaveBeenCalledWith({ width: 480, height: 600 });
  });

  it("does not throw on size-changed when no onSizeChange is provided", async () => {
    const bridge = createMockBridge();
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await act(async () => {
      bridge.emit("sizechange", { height: 320 });
    });
    expect(screen.getByTitle("Cohort App")).toBeInTheDocument();
  });

  it("routes ui/request-display-mode to onRequestDisplayMode and returns the applied mode", async () => {
    const bridge = createMockBridge();
    const onRequestDisplayMode = vi
      .fn<(m: "inline" | "fullscreen" | "pip") => "inline" | "fullscreen">()
      .mockReturnValue("fullscreen");
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
        displayMode="inline"
        onRequestDisplayMode={onRequestDisplayMode}
      />,
    );
    await flushAsync();
    await expect(
      bridge.onrequestdisplaymode?.({ mode: "fullscreen" }),
    ).resolves.toEqual({ mode: "fullscreen" });
    expect(onRequestDisplayMode).toHaveBeenCalledWith("fullscreen");
  });

  it("declines ui/request-display-mode by returning the current displayMode when no handler is provided", async () => {
    const bridge = createMockBridge();
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
        displayMode="fullscreen"
      />,
    );
    await flushAsync();
    await expect(
      bridge.onrequestdisplaymode?.({ mode: "pip" }),
    ).resolves.toEqual({ mode: "fullscreen" });
  });

  it("declines ui/request-display-mode with inline when neither a handler nor displayMode is set", async () => {
    const bridge = createMockBridge();
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await expect(
      bridge.onrequestdisplaymode?.({ mode: "pip" }),
    ).resolves.toEqual({ mode: "inline" });
  });

  it("replays partialInputs in order before the complete tool-input on initialize", async () => {
    const bridge = createMockBridge();
    const ref = createRef<AppRendererHandle>();
    renderWithMantine(
      <AppRenderer
        ref={ref}
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
        partialInputs={[{ city: "N" }, { city: "New" }]}
      />,
    );
    await flushAsync();
    await act(async () => {
      await ref.current?.sendToolInput({ city: "New York" });
      bridge.emit("initialized");
    });
    expect(bridge.sendToolInputPartial).toHaveBeenCalledTimes(2);
    expect(bridge.sendToolInputPartial).toHaveBeenNthCalledWith(1, {
      arguments: { city: "N" },
    });
    expect(bridge.sendToolInputPartial).toHaveBeenNthCalledWith(2, {
      arguments: { city: "New" },
    });
    expect(
      bridge.sendToolInputPartial.mock.invocationCallOrder[1],
    ).toBeLessThan(bridge.sendToolInput.mock.invocationCallOrder[0]);
  });

  it("sends no tool-input-partial when partialInputs is omitted", async () => {
    const bridge = createMockBridge();
    const ref = createRef<AppRendererHandle>();
    renderWithMantine(
      <AppRenderer
        ref={ref}
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await act(async () => {
      await ref.current?.sendToolInput({ city: "NYC" });
      bridge.emit("initialized");
    });
    expect(bridge.sendToolInputPartial).not.toHaveBeenCalled();
  });

  it("forwards MCP log notifications to onLog", async () => {
    const bridge = createMockBridge();
    const onLog = vi.fn();
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
        onLog={onLog}
      />,
    );
    await flushAsync();
    await act(async () => {
      bridge.emit("loggingmessage", { level: "warning", data: "disk full" });
    });
    expect(onLog).toHaveBeenCalledWith({ level: "warning", data: "disk full" });
  });

  it("does not throw on a log notification when no onLog is provided", async () => {
    const bridge = createMockBridge();
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await act(async () => {
      bridge.emit("loggingmessage", { level: "info", data: "hi" });
    });
    expect(screen.getByTitle("Cohort App")).toBeInTheDocument();
  });

  it("routes ui/message to onMessage and returns the spec-required empty result", async () => {
    const bridge = createMockBridge();
    const onMessage = vi.fn();
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
        onMessage={onMessage}
      />,
    );
    await flushAsync();
    const params = {
      role: "user" as const,
      content: [{ type: "text", text: "hello host" }],
    };
    await expect(bridge.onmessage?.(params)).resolves.toEqual({});
    expect(onMessage).toHaveBeenCalledWith(params);
  });

  it("declines ui/message with isError when no onMessage handler is provided", async () => {
    const bridge = createMockBridge();
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await expect(
      bridge.onmessage?.({ role: "user", content: [] }),
    ).resolves.toEqual({ isError: true });
  });

  it("pushes a displayMode change to the running view via host-context-changed", async () => {
    const bridge = createMockBridge();
    // Stable factory identity so the rerender reuses the live bridge instead of
    // rebuilding (which would reset `initialized` and gate the push).
    const factory: BridgeFactory = () => asBridge(bridge);
    const { rerender } = renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
        displayMode="inline"
      />,
    );
    await flushAsync();
    await act(async () => bridge.emit("initialized"));
    bridge.sendHostContextChange.mockClear();
    rerender(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
        displayMode="fullscreen"
      />,
    );
    await flushAsync();
    expect(bridge.sendHostContextChange).toHaveBeenCalledWith({
      displayMode: "fullscreen",
    });
  });

  it("does not push a displayMode change before the view is initialized", async () => {
    const bridge = createMockBridge();
    const factory: BridgeFactory = () => asBridge(bridge);
    const { rerender } = renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
        displayMode="inline"
      />,
    );
    await flushAsync();
    bridge.sendHostContextChange.mockClear();
    // No `initialized` emitted yet — the push must be gated.
    rerender(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
        displayMode="fullscreen"
      />,
    );
    await flushAsync();
    expect(bridge.sendHostContextChange).not.toHaveBeenCalledWith({
      displayMode: "fullscreen",
    });
  });

  it("pushes a live theme flip (with resolved styles) to the running bridge via host-context-changed", async () => {
    const bridge = createMockBridge();
    // Stub the computed design tokens so currentStyles() resolves a non-empty
    // McpUiHostStyles — exercises the theme observer's styles-included path.
    const realGetComputedStyle = window.getComputedStyle;
    const getComputedStyleSpy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((el: Element, pseudo?: string | null) => {
        const decl = realGetComputedStyle.call(window, el, pseudo ?? undefined);
        return {
          ...decl,
          getPropertyValue: (prop: string) =>
            prop === "--mantine-color-body"
              ? "#101113"
              : decl.getPropertyValue(prop),
        } as CSSStyleDeclaration;
      });
    try {
      renderWithMantine(
        <AppRenderer
          sandboxPath="/sandbox.html"
          tool={tool}
          bridgeFactory={() => asBridge(bridge)}
        />,
      );
      await flushAsync();
      // Ignore any seeding from Mantine's own mount-time write — assert only the
      // flip we trigger below.
      bridge.sendHostContextChange.mockClear();

      await act(async () => {
        document.documentElement.setAttribute(
          "data-mantine-color-scheme",
          "dark",
        );
        // MutationObserver callbacks are delivered on a microtask.
        await Promise.resolve();
      });
      expect(bridge.sendHostContextChange).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: "dark",
          styles: expect.objectContaining({
            variables: expect.objectContaining({
              "--color-background-primary": "#101113",
            }),
          }),
        }),
      );
    } finally {
      getComputedStyleSpy.mockRestore();
      document.documentElement.removeAttribute("data-mantine-color-scheme");
    }
  });

  it("stops observing theme changes after the renderer unmounts", async () => {
    const bridge = createMockBridge();
    const { unmount } = renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await act(async () => {
      unmount();
      await Promise.resolve();
      await Promise.resolve();
    });
    bridge.sendHostContextChange.mockClear();

    await act(async () => {
      document.documentElement.setAttribute(
        "data-mantine-color-scheme",
        "dark",
      );
      await Promise.resolve();
    });
    expect(bridge.sendHostContextChange).not.toHaveBeenCalled();
    document.documentElement.removeAttribute("data-mantine-color-scheme");
  });

  describe("containerDimensions", () => {
    // Stub ResizeObserver so tests can drive the callback directly: capture the
    // callback + the observed element so its getBoundingClientRect can be
    // patched before each fire.
    let resizeCallback: (() => void) | undefined;
    let observedEl: HTMLElement | undefined;
    let originalResizeObserver: typeof ResizeObserver | undefined;

    beforeEach(() => {
      resizeCallback = undefined;
      observedEl = undefined;
      originalResizeObserver = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class {
        constructor(cb: () => void) {
          resizeCallback = cb;
        }
        observe(el: Element) {
          observedEl = el as HTMLElement;
        }
        unobserve() {}
        disconnect() {
          resizeCallback = undefined;
        }
      } as unknown as typeof ResizeObserver;
    });
    afterEach(() => {
      if (originalResizeObserver) {
        globalThis.ResizeObserver = originalResizeObserver;
      } else {
        delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
      }
    });

    function stubSize(el: HTMLElement, width: number, height: number) {
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    }

    it("pushes containerDimensions on initialize when the container has a layout box", async () => {
      const bridge = createMockBridge();
      const container = document.createElement("div");
      stubSize(container, 320, 200);
      renderWithMantine(
        <AppRenderer
          sandboxPath="/sandbox.html"
          tool={tool}
          bridgeFactory={() => asBridge(bridge)}
          containerRef={{ current: container }}
        />,
      );
      await flushAsync();
      await act(async () => bridge.emit("initialized"));
      expect(bridge.sendHostContextChange).toHaveBeenCalledWith({
        containerDimensions: { width: 320, height: 200 },
      });
    });

    it("does not push containerDimensions on initialize when the container has no layout box", async () => {
      const bridge = createMockBridge();
      const container = document.createElement("div");
      stubSize(container, 0, 0);
      renderWithMantine(
        <AppRenderer
          sandboxPath="/sandbox.html"
          tool={tool}
          bridgeFactory={() => asBridge(bridge)}
          containerRef={{ current: container }}
        />,
      );
      await flushAsync();
      // A mount-time theme write may have already pushed a {theme} change;
      // clear so we assert only about the initialize-time containerDimensions.
      bridge.sendHostContextChange.mockClear();
      await act(async () => bridge.emit("initialized"));
      expect(bridge.sendHostContextChange).not.toHaveBeenCalled();
    });

    it("does not push containerDimensions on resize before the view is initialized", async () => {
      const bridge = createMockBridge();
      const container = document.createElement("div");
      renderWithMantine(
        <AppRenderer
          sandboxPath="/sandbox.html"
          tool={tool}
          bridgeFactory={() => asBridge(bridge)}
          containerRef={{ current: container }}
        />,
      );
      await flushAsync();
      bridge.sendHostContextChange.mockClear();
      stubSize(container, 640, 480);
      await act(async () => resizeCallback?.());
      expect(bridge.sendHostContextChange).not.toHaveBeenCalled();
    });

    it("pushes containerDimensions on resize once initialized; skips a 0×0 box and a value-equal repeat", async () => {
      const bridge = createMockBridge();
      const container = document.createElement("div");
      renderWithMantine(
        <AppRenderer
          sandboxPath="/sandbox.html"
          tool={tool}
          bridgeFactory={() => asBridge(bridge)}
          containerRef={{ current: container }}
        />,
      );
      await flushAsync();
      await act(async () => bridge.emit("initialized"));
      bridge.sendHostContextChange.mockClear();

      stubSize(container, 640, 480);
      await act(async () => resizeCallback?.());
      expect(bridge.sendHostContextChange).toHaveBeenCalledWith({
        containerDimensions: { width: 640, height: 480 },
      });

      bridge.sendHostContextChange.mockClear();
      stubSize(container, 640, 480);
      await act(async () => resizeCallback?.());
      expect(bridge.sendHostContextChange).not.toHaveBeenCalled();

      stubSize(container, 0, 0);
      await act(async () => resizeCallback?.());
      expect(bridge.sendHostContextChange).not.toHaveBeenCalled();
    });

    it("observes the host-supplied containerRef element instead of the iframe when provided", async () => {
      const bridge = createMockBridge();
      const container = document.createElement("div");
      renderWithMantine(
        <AppRenderer
          sandboxPath="/sandbox.html"
          tool={tool}
          bridgeFactory={() => asBridge(bridge)}
          containerRef={{ current: container }}
        />,
      );
      await flushAsync();
      expect(observedEl).toBe(container);
    });

    it("falls back to observing the iframe when no containerRef is provided", async () => {
      const bridge = createMockBridge();
      renderWithMantine(
        <AppRenderer
          sandboxPath="/sandbox.html"
          tool={tool}
          bridgeFactory={() => asBridge(bridge)}
        />,
      );
      await flushAsync();
      expect(observedEl).toBeInstanceOf(HTMLIFrameElement);
    });

    it("disconnects the ResizeObserver on unmount", async () => {
      const bridge = createMockBridge();
      const { unmount } = renderWithMantine(
        <AppRenderer
          sandboxPath="/sandbox.html"
          tool={tool}
          bridgeFactory={() => asBridge(bridge)}
        />,
      );
      await flushAsync();
      await act(async () => bridge.emit("initialized"));
      await act(async () => {
        unmount();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(resizeCallback).toBeUndefined();
    });
  });

  it("builds a single bridge and does not dispose it under StrictMode double-invoke", async () => {
    // React StrictMode runs effects setup→cleanup→setup in dev. The bridge
    // (a stateful handshake) must survive that as ONE instance — rebuilding it
    // spins up a second transport that double-loads the sandbox and races the
    // app's ui/initialize handshake.
    const bridge = createMockBridge();
    const factory = vi.fn<BridgeFactory>(() => asBridge(bridge));
    const ref = createRef<AppRendererHandle>();
    renderWithMantine(
      <StrictMode>
        <AppRenderer
          ref={ref}
          sandboxPath="/sandbox.html"
          tool={tool}
          bridgeFactory={factory}
        />
      </StrictMode>,
    );
    await flushAsync();

    // One build, and the bridge is NOT torn down by the synthetic remount.
    expect(factory).toHaveBeenCalledTimes(1);
    expect(bridge.teardownResource).not.toHaveBeenCalled();
    expect(bridge.close).not.toHaveBeenCalled();

    // The reused bridge still delivers buffered input once initialized.
    await act(async () => {
      await ref.current?.sendToolInput({ city: "NYC" });
      bridge.emit("initialized");
    });
    expect(bridge.sendToolInput).toHaveBeenCalledTimes(1);
    expect(bridge.sendToolInput).toHaveBeenCalledWith({
      arguments: { city: "NYC" },
    });
  });

  it("teardown disposes the bridge once and is idempotent", async () => {
    const bridge = createMockBridge();
    const ref = createRef<AppRendererHandle>();
    renderWithMantine(
      <AppRenderer
        ref={ref}
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await act(async () => {
      await ref.current?.teardown();
      await ref.current?.teardown();
    });
    expect(bridge.teardownResource).toHaveBeenCalledTimes(1);
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });

  it("does not double-dispose when unmount races an in-flight teardown", async () => {
    const bridge = createMockBridge();
    let resolveTeardown: ((value: Record<string, unknown>) => void) | undefined;
    bridge.teardownResource.mockImplementationOnce(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveTeardown = resolve;
        }),
    );
    const ref = createRef<AppRendererHandle>();
    const { unmount } = renderWithMantine(
      <AppRenderer
        ref={ref}
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();

    // Kick off teardown but leave its `teardownResource` await pending.
    const teardownPromise = ref.current!.teardown();

    // Unmount while teardown is in flight.
    unmount();

    // Resolve the pending teardownResource, then let `close` settle.
    await act(async () => {
      resolveTeardown?.({});
      await teardownPromise;
      for (let i = 0; i < 4; i++) {
        await Promise.resolve();
      }
    });

    expect(bridge.teardownResource).toHaveBeenCalledTimes(1);
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });

  it("send methods are silent no-ops before the bridge resolves", async () => {
    const bridge = createMockBridge();
    let resolveBridge: ((b: AppBridge) => void) | undefined;
    const factory: BridgeFactory = () =>
      new Promise<AppBridge>((resolve) => {
        resolveBridge = resolve;
      });
    const ref = createRef<AppRendererHandle>();
    renderWithMantine(
      <AppRenderer
        ref={ref}
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
      />,
    );
    await act(async () => {
      await ref.current?.sendToolInput({ city: "NYC" });
      await ref.current?.sendToolResult({ content: [] });
      await ref.current?.sendToolCancelled("aborted");
      await ref.current?.teardown();
    });
    expect(bridge.sendToolInput).not.toHaveBeenCalled();
    expect(bridge.sendToolResult).not.toHaveBeenCalled();
    expect(bridge.sendToolCancelled).not.toHaveBeenCalled();
    expect(bridge.teardownResource).not.toHaveBeenCalled();
    // Resolve to satisfy the pending factory before unmount.
    resolveBridge?.(asBridge(bridge));
    await flushAsync();
  });

  it("unmount triggers teardownResource and close", async () => {
    const bridge = createMockBridge();
    const { unmount } = renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await act(async () => {
      unmount();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bridge.teardownResource).toHaveBeenCalledTimes(1);
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });

  it("disposes a bridge that resolves after the component unmounts", async () => {
    const bridge = createMockBridge();
    let resolveBridge: ((b: AppBridge) => void) | undefined;
    const factory: BridgeFactory = () =>
      new Promise<AppBridge>((resolve) => {
        resolveBridge = resolve;
      });
    const { unmount } = renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
      />,
    );
    unmount();
    await act(async () => {
      resolveBridge?.(asBridge(bridge));
      // disposeBridge awaits teardownResource then close — flush enough
      // microtasks to let both calls complete.
      for (let i = 0; i < 8; i++) {
        await Promise.resolve();
      }
    });
    expect(bridge.teardownResource).toHaveBeenCalledTimes(1);
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });

  it("transitions loading -> ready across the view's initialized signal", async () => {
    const bridge = createMockBridge();
    const onAppStatusChange = vi.fn();
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
        onAppStatusChange={onAppStatusChange}
      />,
    );
    await flushAsync();
    // The build starts with "loading" before the bridge resolves.
    expect(onAppStatusChange).toHaveBeenCalledWith("loading");
    expect(onAppStatusChange).not.toHaveBeenCalledWith("ready");
    await act(async () => bridge.emit("initialized"));
    expect(onAppStatusChange).toHaveBeenLastCalledWith("ready");
  });

  it("reports status 'error' when the bridge factory throws synchronously", async () => {
    const onAppStatusChange = vi.fn();
    const factory: BridgeFactory = () => {
      throw new Error("sync boom");
    };
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
        onAppStatusChange={onAppStatusChange}
      />,
    );
    await flushAsync();
    expect(onAppStatusChange).toHaveBeenCalledWith("loading");
    expect(onAppStatusChange).toHaveBeenLastCalledWith("error");
  });

  it("reports status 'error' when the bridge factory rejects", async () => {
    const onAppStatusChange = vi.fn();
    const factory: BridgeFactory = () =>
      Promise.reject(new Error("async boom"));
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
        onAppStatusChange={onAppStatusChange}
      />,
    );
    await flushAsync();
    expect(onAppStatusChange).toHaveBeenLastCalledWith("error");
  });

  it("calls onError when the bridge factory throws", async () => {
    const onError = vi.fn();
    const factory: BridgeFactory = () => {
      throw new Error("boom");
    };
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
        onError={onError}
      />,
    );
    await flushAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe("boom");
  });

  it("wraps non-Error rejections from the factory", async () => {
    const onError = vi.fn();
    const factory: BridgeFactory = () => Promise.reject("plain string");
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
        onError={onError}
      />,
    );
    await flushAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe("plain string");
  });

  it("does not throw when no onError is provided and the factory fails", async () => {
    const factory: BridgeFactory = () => Promise.reject(new Error("ignored"));
    renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
      />,
    );
    await flushAsync();
    expect(screen.getByTitle("Cohort App")).toBeInTheDocument();
  });

  it("rebuilds the bridge when sandboxPath changes", async () => {
    const first = createMockBridge();
    const second = createMockBridge();
    const factory = vi
      .fn<BridgeFactory>()
      .mockReturnValueOnce(asBridge(first))
      .mockReturnValueOnce(asBridge(second));

    const { rerender } = renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox-a.html"
        tool={tool}
        bridgeFactory={factory}
      />,
    );
    await flushAsync();

    rerender(
      <AppRenderer
        sandboxPath="/sandbox-b.html"
        tool={tool}
        bridgeFactory={factory}
      />,
    );
    await flushAsync();

    expect(factory).toHaveBeenCalledTimes(2);
    expect(first.teardownResource).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the bridge when only the tool changes (same factory and sandboxPath)", async () => {
    // Keeps bridgeFactory and sandboxPath stable while swapping the tool, so the
    // sameInputs short-circuit evaluates all the way to `prev.tool === tool` and
    // takes its false arm — driving a real rebuild, not a reuse.
    const first = createMockBridge();
    const second = createMockBridge();
    const factory = vi
      .fn<BridgeFactory>()
      .mockReturnValueOnce(asBridge(first))
      .mockReturnValueOnce(asBridge(second));
    const otherTool: Tool = {
      name: "other_app",
      title: "Other App",
      inputSchema: { type: "object" },
    };

    const { rerender } = renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={factory}
      />,
    );
    await flushAsync();

    rerender(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={otherTool}
        bridgeFactory={factory}
      />,
    );
    await flushAsync();

    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory.mock.calls[1]?.[1]).toBe(otherTool);
    expect(first.teardownResource).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalledTimes(1);
  });

  it("swallows teardownResource errors but still closes the transport", async () => {
    const bridge = createMockBridge();
    bridge.teardownResource.mockRejectedValueOnce(new Error("teardown failed"));
    const { unmount } = renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await act(async () => {
      unmount();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bridge.teardownResource).toHaveBeenCalledTimes(1);
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });

  it("swallows close errors during disposal", async () => {
    const bridge = createMockBridge();
    bridge.close.mockRejectedValueOnce(new Error("close failed"));
    const { unmount } = renderWithMantine(
      <AppRenderer
        sandboxPath="/sandbox.html"
        tool={tool}
        bridgeFactory={() => asBridge(bridge)}
      />,
    );
    await flushAsync();
    await act(async () => {
      unmount();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bridge.teardownResource).toHaveBeenCalledTimes(1);
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });
});
