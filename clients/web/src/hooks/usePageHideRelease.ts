/**
 * Release the backend MCP session when the page goes away (#2824).
 *
 * Closing or reloading a connected tab used to send the backend nothing: the
 * events stream dropped and the session — with its spawned stdio child —
 * lived until the Inspector exited. The backend now reaps a session that has
 * had no events consumer for a grace window, and this hook makes the common
 * case immediate by sending a best-effort disconnect on `pagehide` — the
 * unload-time event browsers recommend, fired for both close and reload, and
 * the one that says whether the page is entering the back/forward cache.
 *
 * Two pagehides must *not* release:
 *
 * - `event.persisted` — the page is entering the back/forward cache and may be
 *   restored as-is, session and all. If it is evicted instead, the backend's
 *   grace timer reaps the session.
 * - An OAuth full-page redirect that will reattach to this very session. Its
 *   resume snapshot records the backend session id before navigating, and
 *   `resumeAfterOAuth` calls `attachToSession` with it on the way back;
 *   releasing here would force that into its fresh-connect fallback. A
 *   snapshot for a *different* session (stale, or written before any session
 *   existed) does not hold this one.
 */

import { useEffect } from "react";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import { readOAuthResumeSnapshot } from "../lib/oauthResume";

/** The two client methods the release needs — all a test has to supply. */
export type PageHideReleasable = Pick<
  InspectorClient,
  "getRemoteBackendSessionId" | "releaseRemoteSessionOnPageHide"
>;

/**
 * The pagehide decision, separate from the listener wiring so it reads as the
 * rule it is. Returns whether a release was sent.
 */
export function releaseOnPageHide(
  client: PageHideReleasable,
  event: Pick<PageTransitionEvent, "persisted">,
): boolean {
  if (event.persisted) return false;
  const sessionId = client.getRemoteBackendSessionId();
  if (!sessionId) return false;
  if (readOAuthResumeSnapshot()?.remoteSessionId === sessionId) return false;
  return client.releaseRemoteSessionOnPageHide();
}

export function usePageHideRelease(client: PageHideReleasable | null): void {
  useEffect(() => {
    if (!client) return;
    const onPageHide = (event: PageTransitionEvent): void => {
      releaseOnPageHide(client, event);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [client]);
}
