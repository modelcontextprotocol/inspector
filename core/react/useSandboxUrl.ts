/**
 * React hook over the `GET /api/config` endpoint, used to recover the MCP Apps
 * sandbox URL the backend serves alongside the SPA. The dev/prod web backends
 * mount `sandbox_proxy.html` on a separate controller port and advertise the
 * resulting URL as `sandboxUrl` on the config payload (see
 * `clients/web/server/vite-hono-plugin.ts`). The Apps screen embeds that URL as
 * the trusted outer iframe of the double-iframe sandbox; without it MCP Apps
 * cannot run, so the screen renders an unavailable state instead.
 *
 * Fetches once on mount. `sandboxUrl` is `undefined` until the fetch resolves
 * and stays `undefined` if the backend omits it (legacy backend, or a build
 * without the sandbox controller) — callers should treat that as "Apps
 * unavailable" rather than falling back to a blank iframe.
 */

import { useCallback, useEffect, useState } from "react";

export interface UseSandboxUrlOptions {
  /** Base URL of the remote server (typically `window.location.origin`). */
  baseUrl: string;
  /** Optional auth token for the `x-mcp-remote-auth` header. */
  authToken?: string;
  /** Fetch function to use (default: globalThis.fetch). Useful in tests. */
  fetchFn?: typeof fetch;
}

export interface UseSandboxUrlResult {
  /** The sandbox proxy URL, or undefined when unavailable / not yet loaded. */
  sandboxUrl: string | undefined;
  /** True while the initial fetch is in flight. */
  loading: boolean;
}

/** Minimal shape we read from the `/api/config` payload. */
interface ConfigPayload {
  sandboxUrl?: unknown;
}

export function useSandboxUrl(opts: UseSandboxUrlOptions): UseSandboxUrlResult {
  const { baseUrl, authToken, fetchFn } = opts;
  const doFetch = fetchFn ?? globalThis.fetch;
  const base = baseUrl.replace(/\/$/, "");

  const [sandboxUrl, setSandboxUrl] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(true);

  // `isCancelled` lets the effect drop a response that resolves after unmount,
  // avoiding a setState on a dead component (React 18 warns, doesn't throw).
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
        // Tolerate a missing/non-string field — anything but a usable URL means
        // "unavailable", which the Apps screen surfaces as its own empty state.
        setSandboxUrl(
          typeof body.sandboxUrl === "string" && body.sandboxUrl
            ? body.sandboxUrl
            : undefined,
        );
      } catch {
        // Network error / aborted fetch: leave sandboxUrl undefined. The Apps
        // screen degrades to its unavailable state rather than a blank iframe.
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

  return { sandboxUrl, loading };
}
