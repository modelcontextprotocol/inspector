import { Box } from "@mantine/core";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref,
  type RefObject,
} from "react";
import type {
  AppBridge,
  AppBridgeEventMap,
  McpUiDisplayMode,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  currentStyles,
  currentTheme,
  measureContainerDimensions,
} from "./createAppBridgeFactory";

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
  /**
   * Called when the running view reports a new rendered content size via
   * `ui/notifications/size-changed` (typically driven by its `ResizeObserver`).
   * Width and height (px) are both optional. The host uses this to resize the
   * iframe's container so the widget is neither clipped nor padded with dead
   * space.
   */
  onSizeChange?: (size: AppBridgeEventMap["sizechange"]) => void;
  /**
   * Current host display mode for the app frame. Pushed to the running view
   * via `host-context-changed` whenever it changes (e.g. Maximize/Restore), so
   * an app can adapt its layout to inline vs fullscreen.
   */
  displayMode?: McpUiDisplayMode;
  /**
   * Handles a view-originated `ui/request-display-mode`. Return the mode the
   * host actually applied — the spec lets the host decline an unsupported mode
   * by returning its current one.
   */
  onRequestDisplayMode?: (requested: McpUiDisplayMode) => McpUiDisplayMode;
  /**
   * Ordered tool-input fragments to replay via
   * `ui/notifications/tool-input-partial` BEFORE the complete `tool-input`,
   * exercising widgets that render progressively. Captured at bridge-build
   * time (see `pendingPartialsRef`) so prop churn never rebuilds the iframe.
   * Nothing is sent when omitted/empty.
   */
  partialInputs?: Record<string, unknown>[];
  /**
   * The host-controlled box the app renders within, used to derive
   * `hostContext.containerDimensions`. This MUST be an element whose size is
   * driven by the host's layout (window resize, sidebar toggle, maximize) and
   * NOT by the view's own `size-changed` reports — otherwise the two signals
   * couple into a feedback loop. Falls back to the iframe element when omitted.
   */
  containerRef?: RefObject<HTMLElement | null>;
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
  onSizeChange,
  displayMode,
  onRequestDisplayMode,
  partialInputs,
  containerRef,
  ref,
}: AppRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Full host-context snapshot. AppBridge.setHostContext replaces its internal
  // baseline with the object passed (it does NOT merge), so passing a partial
  // here would make the next call's diff compare against a partial — and emit
  // unchanged fields as changed. Every push site merges into this snapshot and
  // passes the COMPLETE object so the SDK's per-field diff stays accurate.
  const hostContextRef = useRef<McpUiHostContext>({});
  const bridgeRef = useRef<AppBridge | null>(null);
  const initializedRef = useRef(false);
  const pendingPartialsRef = useRef<Record<string, unknown>[]>([]);
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
  const onSizeChangeRef = useRef(onSizeChange);
  const displayModeRef = useRef(displayMode);
  const onRequestDisplayModeRef = useRef(onRequestDisplayMode);
  const partialInputsRef = useRef(partialInputs);
  const containerElementRef = useRef(containerRef);
  useEffect(() => {
    onErrorRef.current = onError;
    onSizeChangeRef.current = onSizeChange;
    displayModeRef.current = displayMode;
    onRequestDisplayModeRef.current = onRequestDisplayMode;
    partialInputsRef.current = partialInputs;
    containerElementRef.current = containerRef;
  });

  // Merge a patch into the full host-context snapshot and push it to the live
  // bridge (see the hostContextRef comment for why the complete object is sent).
  const pushHostContext = useCallback((patch: Partial<McpUiHostContext>) => {
    hostContextRef.current = { ...hostContextRef.current, ...patch };
    bridgeRef.current?.setHostContext(hostContextRef.current);
  }, []);

  // Flush buffered tool input/result to the view, but only once the bridge
  // exists AND the view has signalled `initialized`. The spec requires tool
  // input/result to arrive after initialization, yet a host-initiated open
  // (the Open App click) fires before the iframe's app has loaded — so we
  // buffer the latest values and release them when the view is ready. Input is
  // always sent before result.
  const flushPending = useCallback(() => {
    const bridge = bridgeRef.current;
    if (!bridge || !initializedRef.current) return;
    // Partial-input fragments first, in staged order, BEFORE the complete
    // tool-input — the spec requires partials to precede the final input.
    while (pendingPartialsRef.current.length > 0) {
      const args = pendingPartialsRef.current.shift();
      if (args) void bridge.sendToolInputPartial({ arguments: args });
    }
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
      pendingPartialsRef.current = [];
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
    // Snapshot the staged partial-input fragments for THIS bridge build (read
    // via the ref so the prop is not a dep — adding/removing fragments must not
    // rebuild the iframe). The StrictMode reuse path above returned before
    // reaching here, so a reused bridge keeps the queue it was built with.
    pendingPartialsRef.current = [...(partialInputsRef.current ?? [])];

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
          // Seed the host-side snapshot from the live host state and push it.
          // Any field may have changed between bridge construction (which the
          // factory seeded into the handshake) and initialization; the SDK
          // diffs and emits only what actually moved.
          const styles = currentStyles();
          const container =
            containerElementRef.current?.current ?? iframeRef.current;
          const containerDimensions = container
            ? measureContainerDimensions(container)
            : undefined;
          const mode = displayModeRef.current;
          hostContextRef.current = {
            theme: currentTheme(),
            ...(styles ? { styles } : {}),
            ...(containerDimensions ? { containerDimensions } : {}),
            ...(mode !== undefined ? { displayMode: mode } : {}),
          };
          bridge.setHostContext(hostContextRef.current);
          flushPending();
        });
        // Forward the view's content-size reports (ui/notifications/size-changed)
        // so the host can resize the iframe container to fit the rendered widget.
        bridge.addEventListener("sizechange", (size) => {
          onSizeChangeRef.current?.(size);
        });
        // Handle ui/request-display-mode: let the host (AppsScreen) decide what
        // mode to actually apply and return that. With no handler the request is
        // declined by returning the current host-side mode.
        bridge.onrequestdisplaymode = async ({ mode }) => {
          const handler = onRequestDisplayModeRef.current;
          const applied = handler
            ? handler(mode)
            : (displayModeRef.current ?? "inline");
          return { mode: applied };
        };
        flushPending();
      })
      .catch((err) => {
        if (buildIdRef.current === buildId) onErrorRef.current?.(toError(err));
      });

    return scheduleDispose;
  }, [bridgeFactory, sandboxPath, tool, flushPending, scheduleDispose]);

  // Push live host-context changes to the running view. The factory only seeds
  // the INITIAL theme into the handshake hostContext, but the spec has the host
  // push partial hostContext diffs (via ui/notifications/host-context-changed)
  // as fields change — so a theme flip while an app is open must reach it too.
  // Mantine writes the resolved scheme to `<html data-mantine-color-scheme>`;
  // observe that attribute and forward changes through the live bridge.
  // `setHostContext` diffs and emits only modified fields, so re-asserting an
  // unchanged theme is a no-op. Reading `bridgeRef.current` at callback time
  // (not capturing a bridge) means the observer always targets the live bridge,
  // even though it resolves asynchronously after this effect runs.
  useEffect(() => {
    if (
      typeof MutationObserver === "undefined" ||
      typeof document === "undefined"
    ) {
      return;
    }
    const observer = new MutationObserver(() => {
      const styles = currentStyles();
      pushHostContext({
        theme: currentTheme(),
        ...(styles ? { styles } : {}),
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mantine-color-scheme"],
    });
    return () => observer.disconnect();
  }, [pushHostContext]);

  // Push live container size to the running view. Observes the host-controlled
  // container (or the iframe as a fallback) — NOT an element whose height is
  // driven by the view's own size-changed reports, which would couple the two
  // signals into a feedback loop. Gated on the view's `initialized` signal so
  // the notification only fires once the handshake is complete, and a 0×0
  // (not-yet-laid-out) measurement is skipped.
  useEffect(() => {
    const target = containerElementRef.current?.current ?? iframeRef.current;
    if (typeof ResizeObserver === "undefined" || !target) return;
    const observer = new ResizeObserver(() => {
      if (!initializedRef.current) return;
      const containerDimensions = measureContainerDimensions(target);
      if (!containerDimensions) return;
      pushHostContext({ containerDimensions });
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [pushHostContext]);

  // Push the host's display mode to the running view whenever it changes
  // (Maximize/Restore, or after we honored a ui/request-display-mode). Gated
  // on `initialized` for the same reason as the other host-context pushes.
  useEffect(() => {
    if (displayMode === undefined) return;
    if (!initializedRef.current) return;
    pushHostContext({ displayMode });
  }, [displayMode, pushHostContext]);

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
