import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/client";
import { ElicitResultSchema } from "@modelcontextprotocol/core";
import { appAdvertisesElicitation } from "./appCapabilities";

/**
 * How long the host waits for an app to answer an elicitation before giving up
 * and falling back to the native UI.
 *
 * Deliberately generous: unlike a tool call, the thing being waited on is a
 * *person* filling in a form, and the SDK's 60s request default would abandon
 * a user who paused to think. Ten minutes bounds a bridge that will never
 * answer (a wedged app, a closed tab) without ever racing a real user.
 */
export const APP_ELICITATION_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Forward a form-mode `elicitation/create` to one specific running MCP App and
 * return the app's standard `ElicitResult` (#1854).
 *
 * This is ext-apps' own `AppBridge.requestElicitation` from
 * modelcontextprotocol/ext-apps#733 — same method, same params, same result —
 * implemented against the bridge's generic `request()` because #733 is not
 * yet in a published release (2.0.0 does not include it). Replace the body
 * with a call to
 * `bridge.requestElicitation(params)` once a release containing #733 ships;
 * nothing on the wire changes when that happens.
 *
 * Throwing is meaningful to every caller: it is the signal to fall back to the
 * native elicitation UI. A user's `decline` or `cancel` is a *resolved* result,
 * never a throw.
 */
export async function requestAppElicitation(
  bridge: AppBridge,
  params: ElicitRequest["params"],
  timeoutMs: number = APP_ELICITATION_TIMEOUT_MS,
): Promise<ElicitResult> {
  // Fail closed on the app's own advertisement rather than discovering it as a
  // "-32601 method not found" ten minutes later: an app that never registered
  // an elicitation handler is a fallback case, not an error case.
  // NOT `bridge.getAppCapabilities()` directly: ext-apps 2.0.0 strips the
  // `elicitation` key when it parses `ui/initialize`. See appCapabilities.ts.
  if (!appAdvertisesElicitation(bridge)) {
    throw new Error("App does not support elicitation");
  }
  // Since ext-apps 2.0.0 `AppBridge` extends the SDK v2 `Protocol`, whose
  // `request()` takes the standard `Request` shape — `ElicitRequest` is one —
  // so the send needs no cast (the 1.x peer's `AppRequest` union had no
  // `ElicitRequest` member, which is what forced a double cast here; #1745).
  // The runtime is a plain JSON-RPC send of the standard method with its
  // standard params, verified against the app-side handler in the fixture and
  // the bridge tests.
  const request: ElicitRequest = { method: "elicitation/create", params };
  return await bridge.request(request, ElicitResultSchema, {
    timeout: timeoutMs,
  });
}
