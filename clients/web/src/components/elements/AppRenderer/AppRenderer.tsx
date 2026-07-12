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
  McpUiMessageRequest,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  CallToolResult,
  LoggingMessageNotification,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  currentStyles,
  currentTheme,
  measureContainerDimensions,
} from "./hostContext";

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

/**
 * High-level lifecycle of a running app, surfaced so a host (or an automated
 * driver polling a `data-app-status` attribute) can wait for the right moment:
 * `loading` while the bridge is being built and the view's `ui/initialize`
 * handshake is in flight; `ready` once the view has fired
 * `notifications/initialized`; `error` when the bridge factory throws or
 * rejects (no live view to wait on).
 */
export type AppRendererStatus = "loading" | "ready" | "error";

export interface AppRendererProps {
  sandboxPath: string;
  tool: Tool;
  bridgeFactory: BridgeFactory;
  onError?: (err: Error) => void;
  /**
   * Reports the renderer's high-level lifecycle (see {@link AppRendererStatus}).
   * Fires `loading` at the start of every (re)build, `ready` when the view
   * signals `initialized`, and `error` on a factory throw/rejection.
   */
  onAppStatusChange?: (status: AppRendererStatus) => void;
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
   * Called when the running view submits a user-role message via
   * `ui/message`. The renderer returns the spec-required empty result on
   * the host's behalf, so the callback is fire-and-forget.
   */
  onMessage?: (params: McpUiMessageRequest["params"]) => void;
  /**
   * Called for each MCP log notification (`notifications/message`) the
   * running view emits. Backs the advertised `logging` host capability.
   */
  onLog?: (params: LoggingMessageNotification["params"]) => void;
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
  onAppStatusChange,
  onSizeChange,
  displayMode,
  onRequestDisplayMode,
  onMessage,
  onLog,
  partialInputs,
  containerRef,
  ref,
}: AppRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
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
  const onAppStatusChangeRef = useRef(onAppStatusChange);
  const onSizeChangeRef = useRef(onSizeChange);
  const displayModeRef = useRef(displayMode);
  const onRequestDisplayModeRef = useRef(onRequestDisplayMode);
  const onMessageRef = useRef(onMessage);
  const onLogRef = useRef(onLog);
  const partialInputsRef = useRef(partialInputs);
  useEffect(() => {
    onErrorRef.current = onError;
    onAppStatusChangeRef.current = onAppStatusChange;
    onSizeChangeRef.current = onSizeChange;
    displayModeRef.current = displayMode;
    onRequestDisplayModeRef.current = onRequestDisplayMode;
    onMessageRef.current = onMessage;
    onLogRef.current = onLog;
    partialInputsRef.current = partialInputs;
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
    // Partial-input fragments first, in staged order, BEFORE the complete
    // tool-input — the spec requires partials to precede the final input.
    for (const args of pendingPartialsRef.current) {
      void bridge.sendToolInputPartial({ arguments: args });
    }
    pendingPartialsRef.current = [];
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
    // This reuse path provably runs under React StrictMode's synchronous
    // setup→cleanup→setup double-invoke (the "builds a single bridge… StrictMode"
    // test proves the bridge is reused, not rebuilt — factory called once). v8
    // cannot attribute coverage to the body of an effect that React replays for
    // the StrictMode dev-only double-invoke, so the branch + its three
    // statements read as uncovered despite executing.
    /* v8 ignore next 4 */
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
    onAppStatusChangeRef.current?.("loading");
    // Snapshot the staged partial-input fragments for THIS bridge build (read
    // via the ref so the prop is not a dep — adding/removing fragments must not
    // rebuild the iframe). The StrictMode reuse path above returned before
    // reaching here, so a reused bridge keeps the queue it was built with.
    pendingPartialsRef.current = [...(partialInputsRef.current ?? [])];

    let pending: Promise<AppBridge>;
    try {
      pending = Promise.resolve(bridgeFactory(iframe, tool));
    } catch (err) {
      onAppStatusChangeRef.current?.("error");
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
          onAppStatusChangeRef.current?.("ready");
          // The factory already seeded theme/styles/displayMode into the
          // handshake hostContext; the observers below cover any subsequent
          // changes. Only containerDimensions can plausibly differ between
          // bridge construction and initialization (layout settles), so push
          // that one field now via the SDK's partial-change notification.
          const container = containerRef?.current ?? iframeRef.current;
          const containerDimensions = container
            ? measureContainerDimensions(container)
            : undefined;
          if (containerDimensions) {
            void bridge.sendHostContextChange({ containerDimensions });
          }
          flushPending();
        });
        // Forward the view's content-size reports (ui/notifications/size-changed)
        // so the host can resize the iframe container to fit the rendered widget.
        bridge.addEventListener("sizechange", (size) => {
          onSizeChangeRef.current?.(size);
        });
        // Forward the view's MCP log notifications so the host can honor the
        // advertised `logging` capability instead of dropping them.
        bridge.addEventListener("loggingmessage", (params) => {
          onLogRef.current?.(params);
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
        // Handle ui/message: surface the submitted content and return the
        // spec-required empty result. With no handler the submission is
        // declined by returning isError.
        bridge.onmessage = async (params) => {
          const handler = onMessageRef.current;
          if (!handler) return { isError: true };
          handler(params);
          return {};
        };
        flushPending();
      })
      .catch((err) => {
        if (buildIdRef.current !== buildId) return;
        onAppStatusChangeRef.current?.("error");
        onErrorRef.current?.(toError(err));
      });

    return scheduleDispose;
    // `containerRef` is listed for exhaustive-deps completeness, but a change to
    // its identity does NOT force a rebuild: the `sameInputs` check above
    // ignores it, so a new ref object hits the StrictMode reuse path (the
    // `initialized` handler reads `containerRef?.current` lazily, so the live
    // ref is always used regardless). The other deps are the real rebuild keys.
  }, [
    bridgeFactory,
    sandboxPath,
    tool,
    containerRef,
    flushPending,
    scheduleDispose,
  ]);

  // Push live host-context changes to the running view as discrete partial
  // updates via AppBridge.sendHostContextChange (the SDK's
  // ui/notifications/host-context-changed sender). Each effect observes one
  // host signal and sends only the field(s) it owns, so the view receives the
  // spec's "only changed fields" partials without any host-side snapshot
  // bookkeeping. Reading `bridgeRef.current` at callback time (not capturing a
  // bridge) means the observers always target the live bridge, even though it
  // resolves asynchronously after these effects run.

  // Theme + styles: Mantine writes the resolved scheme to
  // `<html data-mantine-color-scheme>`; observe that attribute and forward
  // changes through the live bridge. Gated on the view's `initialized` signal
  // — like the container and displayMode pushes below — so a theme flip in the
  // window between bridge construction and the handshake doesn't race
  // `ui/initialize`. Nothing is lost by waiting: the factory seeds the
  // construction-time theme/styles into the handshake hostContext, and the
  // first post-init flip carries the current value.
  useEffect(() => {
    /* v8 ignore next 5 -- SSR/non-DOM guard: MutationObserver and document are
       always defined under happy-dom, so this early return is unreachable in
       the test environment. */
    if (
      typeof MutationObserver === "undefined" ||
      typeof document === "undefined"
    ) {
      return;
    }
    const observer = new MutationObserver(() => {
      if (!initializedRef.current) return;
      const styles = currentStyles();
      void bridgeRef.current?.sendHostContextChange({
        theme: currentTheme(),
        ...(styles ? { styles } : {}),
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mantine-color-scheme"],
    });
    return () => observer.disconnect();
  }, []);

  // Container size: observes the host-controlled container (or the iframe as a
  // fallback) — NOT an element whose height is driven by the view's own
  // size-changed reports, which would couple the two signals into a feedback
  // loop. Gated on the view's `initialized` signal so the notification only
  // fires once the handshake is complete; a 0×0 (not-yet-laid-out) measurement
  // and a value-equal repeat are both skipped.
  useEffect(() => {
    const target = containerRef?.current ?? iframeRef.current;
    /* v8 ignore next -- SSR/non-DOM guard: ResizeObserver is stubbed/defined
       and the iframe (or containerRef) target is always present after mount in
       tests, so neither disjunct is reachable here. */
    if (typeof ResizeObserver === "undefined" || !target) return;
    let last: { width: number; height: number } | undefined;
    const observer = new ResizeObserver(() => {
      if (!initializedRef.current) return;
      const next = measureContainerDimensions(target);
      if (!next) return;
      if (last && last.width === next.width && last.height === next.height) {
        return;
      }
      last = next;
      void bridgeRef.current?.sendHostContextChange({
        containerDimensions: next,
      });
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [containerRef]);

  // Display mode: pushes whenever the prop changes (Maximize/Restore). Gated on
  // `initialized` for the same reason as the other host-context pushes.
  useEffect(() => {
    if (displayMode === undefined) return;
    if (!initializedRef.current) return;
    void bridgeRef.current?.sendHostContextChange({ displayMode });
  }, [displayMode]);

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
