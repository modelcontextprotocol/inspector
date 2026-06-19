import { createRef, StrictMode } from "react";
import { act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
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
  sendToolResult: ReturnType<typeof vi.fn>;
  sendToolCancelled: ReturnType<typeof vi.fn>;
  setHostContext: ReturnType<typeof vi.fn>;
  teardownResource: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  /** Test helper: dispatch a bridge event (e.g. "initialized") to listeners. */
  emit: (event: string, payload?: unknown) => void;
}

function createMockBridge(): MockBridge {
  const listeners: Record<string, ((payload: unknown) => void)[]> = {};
  return {
    sendToolInput: vi.fn().mockResolvedValue(undefined),
    sendToolResult: vi.fn().mockResolvedValue(undefined),
    sendToolCancelled: vi.fn().mockResolvedValue(undefined),
    setHostContext: vi.fn(),
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

  // The host theme lives on `<html data-mantine-color-scheme>`. MantineProvider
  // writes its own scheme there on mount, so these tests manipulate the
  // attribute AFTER render to model a user-driven theme flip on an open app.
  it("re-asserts the theme via setHostContext when the view initializes", async () => {
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
      document.documentElement.setAttribute(
        "data-mantine-color-scheme",
        "dark",
      );
      bridge.emit("initialized");
    });
    expect(bridge.setHostContext).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("pushes a live theme flip to the running bridge via host-context-changed", async () => {
    const bridge = createMockBridge();
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
    bridge.setHostContext.mockClear();

    await act(async () => {
      document.documentElement.setAttribute(
        "data-mantine-color-scheme",
        "dark",
      );
      // MutationObserver callbacks are delivered on a microtask.
      await Promise.resolve();
    });
    expect(bridge.setHostContext).toHaveBeenCalledWith({ theme: "dark" });
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
    bridge.setHostContext.mockClear();

    await act(async () => {
      document.documentElement.setAttribute(
        "data-mantine-color-scheme",
        "dark",
      );
      await Promise.resolve();
    });
    expect(bridge.setHostContext).not.toHaveBeenCalled();
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
