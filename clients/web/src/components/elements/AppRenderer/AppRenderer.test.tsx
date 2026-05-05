import { createRef } from "react";
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
  teardownResource: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createMockBridge(): MockBridge {
  return {
    sendToolInput: vi.fn().mockResolvedValue(undefined),
    sendToolResult: vi.fn().mockResolvedValue(undefined),
    sendToolCancelled: vi.fn().mockResolvedValue(undefined),
    teardownResource: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
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
  });

  it("forwards sendToolInput through the bridge", async () => {
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
    });
    expect(bridge.sendToolInput).toHaveBeenCalledWith({
      arguments: { city: "NYC" },
    });
  });

  it("forwards sendToolResult through the bridge", async () => {
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
    });
    expect(bridge.sendToolResult).toHaveBeenCalledWith(result);
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
