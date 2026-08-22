import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Transport } from "@modelcontextprotocol/client";

/**
 * The app capabilities exactly as the view sent them, per bridge.
 *
 * `AppBridge.getAppCapabilities()` cannot be used for `elicitation` (#1854):
 * ext-apps 1.7.5 parses the view's `ui/initialize` params through
 * `McpUiAppCapabilitiesSchema`, a plain Zod object, so any key that schema does
 * not declare is **stripped before the bridge stores it**. `elicitation` is
 * exactly such a key — it is what ext-apps#733 adds — so an app that correctly
 * advertises it looks, through the bridge's own accessor, like an app that did
 * not. That silently turns every negotiated elicitation into a native-UI
 * fallback, which is indistinguishable from "the feature is off".
 *
 * So the raw frame is observed on the way in and recorded here. A WeakMap keeps
 * this per-bridge (never global) and lets the entry die with the bridge.
 *
 * Delete this module when ext-apps ships #733: `getAppCapabilities()` will
 * carry `elicitation` itself, and {@link appAdvertisesElicitation} already
 * prefers that value.
 */
const rawAppCapabilities = new WeakMap<AppBridge, Record<string, unknown>>();

/** Shape of the `ui/initialize` frame this reads — nothing else is touched. */
interface UiInitializeFrame {
  method?: unknown;
  params?: { appCapabilities?: unknown };
}

/**
 * Wrap a connected bridge's transport so the view's `ui/initialize` params are
 * recorded before the bridge parses them.
 *
 * Call AFTER `bridge.connect(transport)` — `connect` installs the handler this
 * wraps. That ordering is safe: the view cannot send `ui/initialize` until the
 * host has pushed its HTML into the sandbox, which happens later still.
 */
export function observeAppCapabilities(
  bridge: AppBridge,
  transport: Transport,
): void {
  const inner = transport.onmessage?.bind(transport);
  transport.onmessage = (message, extra) => {
    const frame = message as UiInitializeFrame;
    if (frame.method === "ui/initialize") {
      const advertised = frame.params?.appCapabilities;
      if (typeof advertised === "object" && advertised !== null) {
        rawAppCapabilities.set(bridge, advertised as Record<string, unknown>);
      }
    }
    inner?.(message, extra);
  };
}

/**
 * Whether the app running on this bridge advertised the `elicitation`
 * capability. Prefers the bridge's own accessor (correct once ext-apps#733
 * ships) and falls back to the observed raw frame.
 */
export function appAdvertisesElicitation(bridge: AppBridge): boolean {
  const parsed = bridge.getAppCapabilities() as
    | Record<string, unknown>
    | undefined;
  if (parsed?.elicitation) return true;
  return Boolean(rawAppCapabilities.get(bridge)?.elicitation);
}
