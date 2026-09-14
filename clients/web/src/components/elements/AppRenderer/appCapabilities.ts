import { McpUiInitializeRequestSchema } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";

/**
 * The app capabilities exactly as the view sent them, per bridge.
 *
 * `AppBridge.getAppCapabilities()` cannot be used for `elicitation` (#1854):
 * ext-apps 2.0.0 parses the view's `ui/initialize` params through
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

/**
 * The only part of a transport this needs: the inbound-message callback.
 *
 * Structural, and generic over the message type, on purpose. This helper
 * touches one optional property, so naming the SDK `Transport` (which ext-apps'
 * `PostMessageTransport` implements since 2.0.0) would only make every test
 * fake carry `start`/`send`/`close` it never calls. Generic rather than
 * `(message: unknown)` because a handler typed for a narrower message is not
 * assignable to one typed for `unknown` (contravariance), which would put the
 * cast back; `rest` is `never[]` for the same reason, accepting any trailing
 * parameter list without claiming to know it. The message is only ever read
 * through {@link recordAdvertisedCapabilities}, which narrows from `unknown`.
 */
export interface MessageObservable<TMessage = unknown> {
  onmessage?: (message: TMessage, ...rest: never[]) => void;
}

/**
 * The capabilities a view advertised in an `ui/initialize` the bridge will
 * ACCEPT, or `undefined` for any other frame.
 *
 * Acceptance is decided by the bridge's own `McpUiInitializeRequestSchema`
 * rather than a hand-rolled approximation of it — an approximation drifts, and
 * anything it waves through that the bridge rejects becomes a second, laxer
 * route to setting `elicitation` on a frame that negotiated nothing. The one
 * check the schema cannot make is that this is a request at all: a JSON-RPC
 * notification carries the same `method`/`params`, so the id is checked here.
 *
 * The capabilities are then read from the ORIGINAL frame, not the parse output,
 * because that schema is exactly what strips `elicitation` (see the WeakMap's
 * doc comment) — validating with it and reading through it would defeat the
 * purpose of this module.
 */
function acceptedInitializeCapabilities(
  message: unknown,
): Record<string, unknown> | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const frame = message as { id?: unknown; params?: unknown };
  // A notification (no id) is not the handshake request.
  if (frame.id === undefined || frame.id === null) return undefined;
  if (!McpUiInitializeRequestSchema.safeParse(message).success) {
    return undefined;
  }
  const advertised = (frame.params as { appCapabilities?: unknown })
    .appCapabilities;
  return typeof advertised === "object" && advertised !== null
    ? (advertised as Record<string, unknown>)
    : undefined;
}

/**
 * Record `params.appCapabilities` from the view's handshake.
 *
 * Every *accepted* `ui/initialize` replaces the recorded value, because that is
 * what the bridge does — on a second handshake (a view double-mounting under
 * React StrictMode, or reconnecting) it warns and takes the latest appInfo and
 * capabilities. Freezing this at the first frame would leave the gate reporting
 * capabilities the bridge no longer holds, in both directions.
 *
 * A frame the bridge would *reject* records nothing and leaves the previous
 * value alone: it is a route to changing this gate in neither direction.
 */
function recordAdvertisedCapabilities(
  bridge: AppBridge,
  message: unknown,
): void {
  const advertised = acceptedInitializeCapabilities(message);
  if (advertised) rawAppCapabilities.set(bridge, advertised);
}

/**
 * Wrap a connected bridge's transport so the view's `ui/initialize` params are
 * recorded before the bridge parses them.
 *
 * Call AFTER `bridge.connect(transport)` — `connect` installs the handler this
 * wraps. That ordering is safe: the view cannot send `ui/initialize` until the
 * host has pushed its HTML into the sandbox, which happens later still.
 */
export function observeAppCapabilities<TMessage>(
  bridge: AppBridge,
  transport: MessageObservable<TMessage>,
): void {
  const inner = transport.onmessage?.bind(transport);
  transport.onmessage = (message: TMessage, ...rest: never[]) => {
    recordAdvertisedCapabilities(bridge, message);
    inner?.(message, ...rest);
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
  return (
    isCapabilityObject(parsed?.elicitation) ||
    isCapabilityObject(rawAppCapabilities.get(bridge)?.elicitation)
  );
}

/**
 * A declared capability is an OBJECT (`{}` today, room for sub-options later),
 * which is what ext-apps#733 specifies. Truthiness is not the same test: an
 * `elicitation: true` is a value the draft does not define, and treating it as
 * an advertisement would accept something the bridge's own schema will reject
 * the moment it carries the key.
 */
function isCapabilityObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
