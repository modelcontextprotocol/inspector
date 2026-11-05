/**
 * Surfacing destination-guard refusals that OAuth discovery recovers from
 * (#2846).
 *
 * The guard (`core/mcp/node/fetchGuard.ts`, #2749) refuses a metadata URL that
 * points at a link-local or cloud-metadata address. OAuth discovery treats that
 * refusal like any other failed candidate and moves on to the next well-known
 * URL, so when the flow later fails somewhere unrelated — a Dynamic Client
 * Registration 401 at the server's own origin, say — the refusal that changed
 * the path has been swallowed and the user cannot see why discovery went where
 * it did.
 *
 * The fix is to observe the refusal on its way **up** the fetch chain, before
 * any caller gets the chance to swallow it: {@link withFetchRefusalReporting}
 * wraps a fetch, reports every refusal it sees, and rethrows unchanged — so
 * discovery keeps its fallback behaviour, and each client decides how loudly to
 * show the report (a stderr warning in the CLI and mcpdo, a line in the TUI's
 * Auth tab, the Network entry in the web client).
 *
 * Browser-safe on purpose. The error class lives here rather than beside the
 * guard because the web client never runs the guard itself: its OAuth requests
 * go through the backend's `/api/fetch`, which reports a refusal as a 403 the
 * browser rebuilds into this same class ({@link FETCH_TARGET_REFUSED_WIRE_CODE}),
 * so `instanceof` works on both sides of that hop.
 */

import { redactUrlQuery } from "../mcp/fetchTracking.js";
import { requestUrlOf } from "./requestTimeout.js";

/** Raised when a guarded fetch is asked to reach a destination it refuses. */
export class FetchTargetError extends Error {
  override name = "FetchTargetError";
  /**
   * The URL that was refused — the redirect hop the guard declined, which is
   * not necessarily the URL the caller asked for. Unset until the guard's hop
   * loop stamps it, so a refusal raised outside that loop falls back to the
   * request URL when reported.
   */
  url?: string;

  constructor(message: string, url?: string) {
    super(message);
    if (url !== undefined) this.url = url;
  }
}

/**
 * The {@link FetchTargetError} behind `err`, if any. undici reports a refused
 * connection as `TypeError("fetch failed")` with the lookup's error as its
 * `cause`, so the chain is walked rather than `err` alone tested.
 */
export function findFetchTargetError(
  err: unknown,
): FetchTargetError | undefined {
  let current = err;
  // Bounded, in case a cause chain is ever cyclic.
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof FetchTargetError) return current;
    current = current.cause;
  }
  return undefined;
}

/** Marks a `/api/fetch` 403 as a destination-guard refusal. */
export const FETCH_TARGET_REFUSED_WIRE_CODE = "fetch_target_refused";

/** The body `/api/fetch` returns when the guard refused the destination. */
export interface FetchTargetRefusedWire {
  error: string;
  code: typeof FETCH_TARGET_REFUSED_WIRE_CODE;
  url?: string;
}

/** Whether a parsed `/api/fetch` error body is a destination-guard refusal. */
export function isFetchTargetRefusedWire(
  value: unknown,
): value is FetchTargetRefusedWire {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.code === FETCH_TARGET_REFUSED_WIRE_CODE &&
    typeof candidate.error === "string" &&
    (candidate.url === undefined || typeof candidate.url === "string")
  );
}

/** One refusal, as reported to a client. */
export interface FetchRefusal {
  /** The refused URL, with credential-bearing query values redacted. */
  url: string;
  /** The guard's own explanation. */
  reason: string;
}

/** The one-line form every client prints: `Refused to fetch <url>: <reason>`. */
export function formatFetchRefusal(refusal: FetchRefusal): string {
  return `Refused to fetch ${refusal.url}: ${refusal.reason}`;
}

/**
 * `base`, reporting every destination-guard refusal to `onRefusal` before
 * rethrowing it unchanged. Any other failure passes through unreported.
 *
 * `onRefusal` runs synchronously inside the rejection path, so it must not
 * throw; a reporter that does would replace the refusal the caller is owed.
 */
export function withFetchRefusalReporting(
  base: typeof fetch,
  onRefusal: (refusal: FetchRefusal) => void,
): typeof fetch {
  return async (input, init) => {
    try {
      return await base(input, init);
    } catch (err) {
      const refused = findFetchTargetError(err);
      if (refused) {
        onRefusal({
          url: redactUrlQuery(refused.url ?? requestUrlOf(input)),
          reason: refused.message,
        });
      }
      throw err;
    }
  };
}
