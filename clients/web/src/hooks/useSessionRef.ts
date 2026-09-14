import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import type { PendingReauth } from "../utils/pendingReauth";
import type { PendingStepUp } from "../utils/stepUp";

/**
 * The session values App.tsx's long-lived callbacks read *currently* rather
 * than as of the render that created them.
 *
 * `activeServerName` is the one field with a rule of its own — see the hook.
 */
export interface SessionSnapshot {
  /** Name of the last server that was active; see `useSessionRef`. */
  activeServerName: string | undefined;
  activeServerId: string | undefined;
  servers: ServerEntry[];
  /**
   * The live client. Mirrored because a settings write that outlives a
   * disconnect/reconnect to the *same* server would otherwise push its value
   * into the instance captured when it was issued — which has since been
   * destroyed — while the replacement client, built from the stale list entry,
   * keeps the value the write replaced (#2089).
   */
  inspectorClient: InspectorClient | null;
  /**
   * The two OAuth-recovery slots. Unlike the fields above they are **not**
   * supplied to this hook: they are owned by `useOAuthRecovery`, which mirrors
   * them in an effect of its own (#2153). Keeping them off `SessionValues`
   * is what lets that hook both own the state and read the ref — App.tsx
   * would otherwise have to hold the state purely to hand it back.
   */
  pendingStepUp: PendingStepUp | null;
  pendingReauth: PendingReauth | null;
}

/**
 * What the caller supplies each render. `activeServerName` is derived, and the
 * two pending-OAuth slots are written by their owner — see
 * {@link SessionSnapshot}.
 */
export type SessionValues = Omit<
  SessionSnapshot,
  "activeServerName" | "pendingStepUp" | "pendingReauth"
>;

/** A stable handle onto the latest {@link SessionSnapshot}. */
export type SessionRef = RefObject<SessionSnapshot>;

/**
 * Mirrors the session values into a single stable ref, so a callback can read
 * the current value without listing it as a dependency and being re-created on
 * every change.
 *
 * This is the standard "latest ref" pattern, written once instead of once per
 * value — App.tsx previously kept six such refs and three sync effects. It is
 * **not** a store: nothing renders off it, nothing subscribes to it, and
 * mutating it never schedules a render. It is also not the prop→state sync
 * that AGENTS.md forbids, which is about `setState` in an effect; a ref write
 * produces no render at all, which is the whole point.
 *
 * Because the ref identity never changes, a hook that takes it takes a
 * *stable* dependency — which is what lets App.tsx's coupled clusters be
 * extracted one at a time without each one dragging the others into its
 * argument list.
 *
 * The single non-uniform field is `activeServerName`: it holds the name of the
 * last server that *was* active and is never cleared. A transport crash
 * dispatches `disconnect`, which clears `activeServerId` — and therefore the
 * active entry — before the failure toast is raised, so the sticky name is the
 * only surviving handle on which server just died.
 */
export function useSessionRef(values: SessionValues): SessionRef {
  const ref = useRef<SessionSnapshot>({
    activeServerName: undefined,
    pendingStepUp: null,
    pendingReauth: null,
    ...values,
  });
  // Deliberately un-gated: this is a passive mirror, so re-assigning the same
  // values on a render that changed none of them costs nothing and removes the
  // dependency list as a place for a newly-added field to be forgotten.
  useEffect(() => {
    const activeServer = values.servers.find(
      (s) => s.id === values.activeServerId,
    );
    if (activeServer) ref.current.activeServerName = activeServer.name;
    ref.current.activeServerId = values.activeServerId;
    ref.current.servers = values.servers;
    ref.current.inspectorClient = values.inspectorClient;
  });
  return ref;
}
