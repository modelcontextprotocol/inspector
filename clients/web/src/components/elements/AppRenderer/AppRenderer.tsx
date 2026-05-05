import { Box } from "@mantine/core";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
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
  const teardownStartedRef = useRef(false);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let cancelled = false;
    teardownStartedRef.current = false;

    let pending: Promise<AppBridge>;
    try {
      pending = Promise.resolve(bridgeFactory(iframe));
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
      })
      .catch((err) => {
        if (!cancelled) onErrorRef.current?.(toError(err));
      });

    return () => {
      cancelled = true;
      const bridge = bridgeRef.current;
      bridgeRef.current = null;
      if (bridge) void disposeBridge(bridge);
    };
  }, [bridgeFactory, sandboxPath]);

  useImperativeHandle(
    ref,
    () => ({
      async sendToolInput(args) {
        const bridge = bridgeRef.current;
        if (!bridge) return;
        await bridge.sendToolInput({ arguments: args });
      },
      async sendToolResult(result) {
        const bridge = bridgeRef.current;
        if (!bridge) return;
        await bridge.sendToolResult(result);
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
        await disposeBridge(bridge);
      },
    }),
    [],
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
