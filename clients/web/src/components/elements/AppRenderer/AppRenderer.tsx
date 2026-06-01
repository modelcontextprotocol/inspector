import { Box } from "@mantine/core";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref,
} from "react";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Constructs the `AppBridge` for a freshly mounted sandbox iframe. Wrap with
 * `useCallback` (or hoist out of render) — the renderer treats a new factory
 * identity as a signal to tear down the current bridge and rebuild, so an
 * unstable factory will thrash the iframe on every render.
 */
export type BridgeFactory = (
  iframe: HTMLIFrameElement,
  tool: Tool,
) => AppBridge | Promise<AppBridge>;

export interface AppRendererHandle {
  sendToolInput(args: Record<string, unknown>): Promise<void>;
  sendToolResult(result: CallToolResult): Promise<void>;
  sendToolCancelled(reason: string): Promise<void>;
  teardown(): Promise<void>;
}

export interface AppRendererProps {
  sandboxPath: string;
  tool: Tool;
  bridgeFactory: BridgeFactory;
  onError?: (err: Error) => void;
  ref?: Ref<AppRendererHandle>;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

async function disposeBridge(bridge: AppBridge): Promise<void> {
  // Best-effort: still close the transport even if teardownResource fails,
  // otherwise the iframe unmount would leak MessagePort listeners.
  try {
    await bridge.teardownResource({});
  } catch {
    /* swallow — closing transport below is the load-bearing step */
  }
  try {
    await bridge.close();
  } catch {
    /* swallow — already disposing */
  }
}

export function AppRenderer({
  sandboxPath,
  tool,
  bridgeFactory,
  onError,
  ref,
}: AppRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const initializedRef = useRef(false);
  const pendingInputRef = useRef<Record<string, unknown> | null>(null);
  const pendingResultRef = useRef<CallToolResult | null>(null);
  const teardownStartedRef = useRef(false);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  // Flush buffered tool input/result to the view, but only once the bridge
  // exists AND the view has signalled `initialized`. The spec requires tool
  // input/result to arrive after initialization, yet a host-initiated open
  // (the Open App click) fires before the iframe's app has loaded — so we
  // buffer the latest values and release them when the view is ready. Input is
  // always sent before result.
  const flushPending = useCallback(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !initializedRef.current) return;
    if (pendingInputRef.current !== null) {
      const args = pendingInputRef.current;
      pendingInputRef.current = null;
      void bridge.sendToolInput({ arguments: args });
    }
    if (pendingResultRef.current !== null) {
      const result = pendingResultRef.current;
      pendingResultRef.current = null;
      void bridge.sendToolResult(result);
    }
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let cancelled = false;
    teardownStartedRef.current = false;
    initializedRef.current = false;

    let pending: Promise<AppBridge>;
    try {
      pending = Promise.resolve(bridgeFactory(iframe, tool));
    } catch (err) {
      onErrorRef.current?.(toError(err));
      return () => {
        cancelled = true;
      };
    }

    pending
      .then((bridge) => {
        if (cancelled) {
          void disposeBridge(bridge);
          return;
        }
        bridgeRef.current = bridge;
        // Registered before the inner app can finish loading (which only
        // happens after the sandbox-resource-ready round-trip the factory
        // drives), so the view's `initialized` signal is never missed.
        bridge.addEventListener("initialized", () => {
          initializedRef.current = true;
          flushPending();
        });
        flushPending();
      })
      .catch((err) => {
        if (!cancelled) onErrorRef.current?.(toError(err));
      });

    return () => {
      cancelled = true;
      const bridge = bridgeRef.current;
      bridgeRef.current = null;
      initializedRef.current = false;
      pendingInputRef.current = null;
      pendingResultRef.current = null;
      if (bridge) void disposeBridge(bridge);
    };
  }, [bridgeFactory, sandboxPath, tool, flushPending]);

  useImperativeHandle(
    ref,
    () => ({
      async sendToolInput(args) {
        // Buffered (latest-wins) and released by flushPending once the view is
        // initialized — the handle may be invoked before the bridge resolves.
        pendingInputRef.current = args;
        flushPending();
      },
      async sendToolResult(result) {
        pendingResultRef.current = result;
        flushPending();
      },
      async sendToolCancelled(reason) {
        const bridge = bridgeRef.current;
        if (!bridge) return;
        await bridge.sendToolCancelled({ reason });
      },
      async teardown() {
        const bridge = bridgeRef.current;
        if (!bridge || teardownStartedRef.current) return;
        teardownStartedRef.current = true;
        // Null the ref synchronously so a concurrent unmount cleanup cannot
        // see a still-live bridge and dispose it a second time.
        bridgeRef.current = null;
        initializedRef.current = false;
        pendingInputRef.current = null;
        pendingResultRef.current = null;
        await disposeBridge(bridge);
      },
    }),
    [flushPending],
  );

  // The iframe deliberately has no `sandbox` attribute: `sandboxPath` resolves
  // to the inspector's own bundled sandbox-proxy page (trusted, same-origin),
  // which then loads the untrusted MCP App content into a nested sandboxed
  // iframe. Sandboxing this outer frame would block the postMessage bridge
  // that `AppBridge` relies on.
  return (
    <Box
      component="iframe"
      ref={iframeRef}
      src={sandboxPath}
      title={tool.title ?? tool.name}
      w="100%"
      h="100%"
      bd={0}
      display="block"
    />
  );
}
