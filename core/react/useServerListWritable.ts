/**
 * React hook over the `GET /api/config` endpoint that recovers the session's
 * `writable` flag. The backend sets `writable: false` when the web UI was
 * launched against a read-only server list — a `--config` session file or an
 * ad-hoc `--server-url` / command target — so the UI can hide catalog CRUD
 * (add / edit / remove / reorder / settings-save) it would only get a 403 for.
 *
 * Mirrors {@link useSandboxUrl} (same `/api/config` source, same fetch shape).
 * Defaults to `true` until the fetch resolves and whenever the field is absent
 * (a legacy backend that predates the flag), so the default catalog and
 * `--catalog` keep full CRUD without any UI change.
 */

import { useCallback, useEffect, useState } from "react";

export interface UseServerListWritableOptions {
  /** Base URL of the remote server (typically `window.location.origin`). */
  baseUrl: string;
  /** Optional auth token for the `x-mcp-remote-auth` header. */
  authToken?: string;
  /** Fetch function to use (default: globalThis.fetch). Useful in tests. */
  fetchFn?: typeof fetch;
}

export interface UseServerListWritableResult {
  /** Whether the server list is writable (catalog) or read-only (session). */
  writable: boolean;
  /** True while the initial fetch is in flight. */
  loading: boolean;
}

/** Minimal shape we read from the `/api/config` payload. */
interface ConfigPayload {
  writable?: unknown;
}

export function useServerListWritable(
  opts: UseServerListWritableOptions,
): UseServerListWritableResult {
  const { baseUrl, authToken, fetchFn } = opts;
  const doFetch = fetchFn ?? globalThis.fetch;
  const base = baseUrl.replace(/\/$/, "");

  // Default writable so the common (catalog) case shows CRUD immediately and a
  // legacy backend that omits the field keeps working.
  const [writable, setWritable] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(
    async (isCancelled: () => boolean): Promise<void> => {
      const headers: Record<string, string> = {};
      if (authToken) headers["x-mcp-remote-auth"] = `Bearer ${authToken}`;
      try {
        const res = await doFetch(`${base}/api/config`, {
          method: "GET",
          headers,
        });
        if (isCancelled() || !res.ok) return;
        const body = (await res.json()) as ConfigPayload;
        if (isCancelled()) return;
        // Only an explicit `false` makes the list read-only; a missing field
        // (legacy backend) stays writable.
        setWritable(body.writable !== false);
      } catch {
        // Network error / aborted fetch: leave writable at its default (true).
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [base, authToken, doFetch],
  );

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  return { writable, loading };
}
