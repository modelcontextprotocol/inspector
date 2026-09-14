import { useCallback, useEffect, useRef, useState } from "react";
import type { OAuthStorage } from "../auth/storage.js";
import {
  clearEmaIdpSession,
  getEmaIdpLoginState,
  normalizeIdpIssuer,
  type EmaIdpLoginState,
} from "../auth/ema/idpSession.js";

export interface UseEmaIdpLoginStateResult {
  loginState: EmaIdpLoginState;
  refresh: () => Promise<void>;
  logout: () => void;
}

/**
 * What a completed read told us, and *which issuer* it was told about.
 *
 * The pair is stored together rather than as a bare `EmaIdpLoginState`
 * because a login state is only ever meaningful for the issuer it was read
 * for. With a bare value, changing issuer carries the previous issuer's
 * answer over to the new one until a fresh read lands — and if that read
 * fails, indefinitely, so the settings surface reports "logged in" for an
 * IdP nobody has authenticated against.
 */
interface ReadResult {
  issuer: string;
  value: EmaIdpLoginState;
}

/**
 * Read and clear EMA IdP session state for Client Settings UX.
 * Pass `active: true` while the settings surface is open to refresh on open.
 */
export function useEmaIdpLoginState(
  storage: OAuthStorage,
  issuer: string | undefined,
  active: boolean,
): UseEmaIdpLoginStateResult {
  const normalizedIssuer = issuer ? normalizeIdpIssuer(issuer) : "";
  const [read, setRead] = useState<ReadResult>({ issuer: "", value: "none" });

  /**
   * Monotonic read token — the same device `useInitialConfig` uses. Reads are
   * unordered, so an issuer flipped A → B → A can have the first A read
   * resolve last; a completion may commit only while it still holds the
   * current token. `logout` claims one too, so a read already in flight when
   * the session is cleared cannot land on top of the clear.
   */
  const generation = useRef(0);

  // Derived rather than stored: with no issuer there is nothing to be logged
  // in to, and a result read for some *other* issuer says nothing about this
  // one. A mismatch therefore reports "none" instead of the previous issuer's
  // answer, which is also what makes the failure path below safe.
  const loginState: EmaIdpLoginState =
    normalizedIssuer && read.issuer === normalizedIssuer ? read.value : "none";

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    if (!normalizedIssuer) return;
    const value = await getEmaIdpLoginState(storage, normalizedIssuer);
    if (generation.current !== mine) return;
    setRead({ issuer: normalizedIssuer, value });
  }, [storage, normalizedIssuer]);

  useEffect(() => {
    if (!active) return;
    // Reading the persisted IdP session *is* the external system this effect
    // exists to synchronize with, and no commit happens here: `refresh`
    // returns before its first `await` when there is no issuer, and otherwise
    // commits in a continuation. That is also why this needs no
    // `set-state-in-effect` suppression, where `useServers` and
    // `useInitialConfig` do — deriving `loginState` from an issuer-keyed read
    // took the last synchronous setState out of the path.
    refresh().catch(() => {
      // `refresh` does not own its failures: `getEmaIdpLoginState` awaits
      // `storage.getIdpSession`, which rejects when the backend is
      // unreachable. Swallow it here so it does not surface as an unhandled
      // rejection, and commit nothing — the issuer keying above is what makes
      // that safe. A failed read for a *new* issuer reports "none", because
      // no result for that issuer exists; a failed re-read of the issuer
      // already on screen keeps the last answer we actually got, which is the
      // right reading of a transient storage outage.
    });
  }, [active, refresh]);

  const logout = useCallback(() => {
    if (!normalizedIssuer) return;
    // Supersede any read in flight: it was started before the session was
    // cleared, so its answer is already wrong by the time it resolves.
    const mine = ++generation.current;
    void clearEmaIdpSession(storage, normalizedIssuer)
      .then(() => {
        if (generation.current !== mine) return;
        setRead({ issuer: normalizedIssuer, value: "none" });
      })
      .catch(() => {
        // Clearing the persisted IdP session failed (e.g. the storage backend
        // is unreachable). Swallow the rejection so it does not surface as an
        // unhandled promise, and leave the last read in place so the UI keeps
        // reflecting the still-present session rather than falsely showing
        // signed-out.
      });
  }, [storage, normalizedIssuer]);

  return { loginState, refresh, logout };
}
