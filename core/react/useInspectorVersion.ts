/**
 * React hook over the `GET /api/config` endpoint that recovers the Inspector
 * `version` the backend reads from the root `package.json`. The browser can't
 * read the filesystem the way the CLI/TUI do, so the version is delivered on the
 * config payload (see `webServerConfigToInitialPayload`) and surfaced here.
 *
 * Mirrors {@link useSandboxUrl} / {@link useServerListWritable} (same
 * `/api/config` source, same fetch shape). `version` is `undefined` until the
 * fetch resolves, and stays `undefined` if the backend omits it (a legacy
 * backend that predates the field) — the UI simply renders nothing then.
 */

import { useCallback, useEffect, useState } from "react";

export interface UseInspectorVersionOptions {
  /** Base URL of the remote server (typically `window.location.origin`). */
  baseUrl: string;
  /** Optional auth token for the `x-mcp-remote-auth` header. */
  authToken?: string;
  /** Fetch function to use (default: globalThis.fetch). Useful in tests. */
  fetchFn?: typeof fetch;
}

export interface UseInspectorVersionResult {
  /** The Inspector version, or undefined when unavailable / not yet loaded. */
  version: string | undefined;
  /** True while the initial fetch is in flight. */
  loading: boolean;
}

/** Minimal shape we read from the `/api/config` payload. */
interface ConfigPayload {
  version?: unknown;
}

export function useInspectorVersion(
  opts: UseInspectorVersionOptions,
): UseInspectorVersionResult {
  const { baseUrl, authToken, fetchFn } = opts;
  const doFetch = fetchFn ?? globalThis.fetch;
  const base = baseUrl.replace(/\/$/, "");

  const [version, setVersion] = useState<string | undefined>(undefined);
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
        // Tolerate a missing/non-string field — a legacy backend that omits it
        // leaves the version hidden rather than showing a bogus value.
        setVersion(
          typeof body.version === "string" && body.version
            ? body.version
            : undefined,
        );
      } catch {
        // Network error / aborted fetch: leave version undefined (hidden).
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

  return { version, loading };
}
