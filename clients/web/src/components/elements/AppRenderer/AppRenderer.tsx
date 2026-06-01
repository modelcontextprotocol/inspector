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

/**
 * Bridge lifecycle (the interlocking refs below):
 *
 *   mount ─▶ build (buildId++) ─▶ factory(iframe,tool) ─async─▶ bridgeRef set
 *                                                              │ on "initialized"
 *                                                              ▼ → flushPending
 *   cleanup ─▶ scheduleDispose() ──microtask──▶ dispose (unless cancelled)
 *                     ▲                                  │
 *                     └── re-setup with SAME inputs ─────┘  cancel + REUSE bridge
 *
 * - `buildId` (monotonic): a bridge resolved from an older build self-disposes.
 * - `disposeScheduled`: a dispose is queued (microtask); a synchronous re-setup
 *   (StrictMode double-invoke, or a transient re-render) cancels it and reuses
 *   the live bridge instead of rebuilding (rebuild double-loads the sandbox and
 *   races the app handshake). A re-setup with CHANGED inputs disposes + rebuilds.
 * - `lastDeps`: distinguishes "same inputs → reuse" from "changed → rebuild".
 * - `initialized`: gates flushing buffered input/result until the view is ready.
 * - `pendingInput`/`pendingResult`: latest-wins buffer for host-initiated open.
 * - `teardownStarted`: makes the imperative teardown() idempotent vs unmount.
 */
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
  // Bridge-lifecycle bookkeeping for the deferred-dispose / reuse dance that
  // keeps a single bridge alive across React StrictMode's dev-only
  // setup→cleanup→setup double-invoke (see the build effect below).
  const buildIdRef = useRef(0);
  const disposeScheduledRef = useRef(false);
  const lastDepsRef = useRef<{
    bridgeFactory: BridgeFactory;
    sandboxPath: string;
    tool: Tool;
  } | null>(null);
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

  // Dispose the live bridge, but deferred to a microtask. React StrictMode runs
  // effects setup→cleanup→setup synchronously in dev; deferring lets the
  // re-setup cancel the disposal and keep the SAME bridge, instead of tearing
  // it down and rebuilding. A rebuild here spins up a second transport that
  // re-posts sandbox-resource-ready (the sandbox loads the app twice) and
  // races the app's ui/initialize handshake — which is what left apps stuck on
  // an empty shell ("handshake timed out") in dev.
  const scheduleDispose = useCallback(() => {
    disposeScheduledRef.current = true;
    queueMicrotask(() => {
      if (!disposeScheduledRef.current) return; // cancelled by a re-setup
      disposeScheduledRef.current = false;
      // Invalidate any in-flight factory so a late-resolving bridge disposes
      // itself instead of attaching to a torn-down component.
      buildIdRef.current++;
      const bridge = bridgeRef.current;
      bridgeRef.current = null;
      initializedRef.current = false;
      lastDepsRef.current = null;
      if (bridge) void disposeBridge(bridge);
    });
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const prev = lastDepsRef.current;
    const sameInputs =
      prev !== null &&
      prev.bridgeFactory === bridgeFactory &&
      prev.sandboxPath === sandboxPath &&
      prev.tool === tool;

    // A disposal scheduled by the immediately-preceding cleanup means we are in
    // a synchronous re-setup. If the inputs are identical (StrictMode's
    // double-invoke, or a transient re-render) keep the live bridge: cancel the
    // disposal and re-deliver any buffered input/result to it.
    if (disposeScheduledRef.current && sameInputs) {
      disposeScheduledRef.current = false;
      flushPending();
      return scheduleDispose;
    }

    // Otherwise this is a real (re)build. If a disposal was pending (inputs
    // changed), run it synchronously before building the replacement.
    if (disposeScheduledRef.current) {
      disposeScheduledRef.current = false;
      buildIdRef.current++;
      const old = bridgeRef.current;
      bridgeRef.current = null;
      initializedRef.current = false;
      if (old) void disposeBridge(old);
    }

    lastDepsRef.current = { bridgeFactory, sandboxPath, tool };
    const buildId = ++buildIdRef.current;
    teardownStartedRef.current = false;
    initializedRef.current = false;

    let pending: Promise<AppBridge>;
    try {
      pending = Promise.resolve(bridgeFactory(iframe, tool));
    } catch (err) {
      onErrorRef.current?.(toError(err));
      return scheduleDispose;
    }

    pending
      .then((bridge) => {
        if (buildIdRef.current !== buildId) {
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
        if (buildIdRef.current === buildId) onErrorRef.current?.(toError(err));
      });

    return scheduleDispose;
  }, [bridgeFactory, sandboxPath, tool, flushPending, scheduleDispose]);

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
        // see a still-live bridge and dispose it a second time. Bumping the
        // build id makes any in-flight factory self-dispose, and clearing the
        // pending-dispose flag/cached deps prevents the deferred dispose from
        // acting on an already torn-down bridge.
        buildIdRef.current++;
        disposeScheduledRef.current = false;
        lastDepsRef.current = null;
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
