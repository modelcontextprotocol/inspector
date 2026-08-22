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
 * implemented against the bridge's generic `request()` because the released
 * package (1.7.5) predates that PR. Replace the body with a call to
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
  // NOT `bridge.getAppCapabilities()` directly: ext-apps 1.7.5 strips the
  // `elicitation` key when it parses `ui/initialize`. See appCapabilities.ts.
  if (!appAdvertisesElicitation(bridge)) {
    throw new Error("App does not support elicitation");
  }
  // ext-apps 1.7.5's send union (`AppRequest`) has no `ElicitRequest` member —
  // that is precisely what #733 adds — so TypeScript sees no overlap with the
  // existing members and a single `as` is rejected. The double cast is the
  // documented-gap case: the runtime is a plain JSON-RPC send of the standard
  // method with its standard params, verified against the app-side handler in
  // the fixture and the bridge tests. Confined to this one line and removed
  // with the ext-apps bump, when `bridge.requestElicitation(params)` replaces it.
  const request = {
    method: "elicitation/create",
    params,
  } as unknown as Parameters<AppBridge["request"]>[0];
  return (await bridge.request(request, ElicitResultSchema, {
    timeout: timeoutMs,
  })) as ElicitResult;
}
