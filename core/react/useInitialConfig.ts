/**
 * React hook over the `GET /api/config` endpoint — the single fetch of the
 * static `InitialConfigPayload` the dev/prod web backends serve alongside the
 * SPA (see `core/mcp/remote/node/server.ts`). It exposes the three fields the
 * web app reads off that payload:
 *
 * - `sandboxUrl` — the MCP Apps sandbox proxy URL. The backend mounts
 *   `sandbox_proxy.html` on a separate controller port and advertises the URL
 *   here; the Apps screen embeds it as the trusted outer iframe. `undefined`
 *   until the fetch resolves, and whenever the backend omits it (legacy backend,
 *   or a build without the sandbox controller) — callers treat that as "Apps
 *   unavailable" rather than a blank iframe.
 * - `writable` — whether the session's server list is a writable catalog or a
 *   read-only session (`--config` / ad-hoc `--server-url`). Defaults to `true`
 *   until the fetch resolves and whenever the field is absent (a legacy backend
 *   predating the flag), so the default catalog keeps full CRUD.
 * - `version` — the Inspector version the backend reads from the root
 *   `package.json` (the browser can't read it off disk). `undefined` until the
 *   fetch resolves, and whenever the backend omits it (legacy backend) — the UI
 *   renders nothing then.
 *
 * This consolidates the three former single-field hooks (`useSandboxUrl`,
 * `useServerListWritable`, `useInspectorVersion`), each of which fetched the
 * same static payload separately, into one request (#1643).
 *
 * Fetches on mount, and re-fetches if `baseUrl` or `authToken` changes (rare —
 * effectively a full reload; the GET is idempotent). Unmount-safe: a response
 * that resolves after unmount is dropped rather than setting state on a dead
 * component.
 */

import { useCallback, useEffect, useState } from "react";

export interface UseInitialConfigOptions {
  /** Base URL of the remote server (typically `window.location.origin`). */
  baseUrl: string;
  /** Optional auth token for the `x-mcp-remote-auth` header. */
  authToken?: string;
  /** Fetch function to use (default: globalThis.fetch). Useful in tests. */
  fetchFn?: typeof fetch;
}

export interface UseInitialConfigResult {
  /** The Inspector version, or undefined when unavailable / not yet loaded. */
  version: string | undefined;
  /** The sandbox proxy URL, or undefined when unavailable / not yet loaded. */
  sandboxUrl: string | undefined;
  /** Whether the server list is writable (catalog) or read-only (session). */
  writable: boolean;
  /** True while the initial fetch is in flight. */
  loading: boolean;
}

/** Minimal shape we read from the `/api/config` payload. */
interface ConfigPayload {
  version?: unknown;
  sandboxUrl?: unknown;
  writable?: unknown;
}

/** Coerce a payload field to a usable non-empty string, else undefined. */
function usableString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function useInitialConfig(
  opts: UseInitialConfigOptions,
): UseInitialConfigResult {
  const { baseUrl, authToken, fetchFn } = opts;
  const doFetch = fetchFn ?? globalThis.fetch;
  const base = baseUrl.replace(/\/$/, "");

  const [version, setVersion] = useState<string | undefined>(undefined);
  const [sandboxUrl, setSandboxUrl] = useState<string | undefined>(undefined);
  // Default writable so the common (catalog) case shows CRUD immediately and a
  // legacy backend that omits the field keeps working.
  const [writable, setWritable] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);

  // `isCancelled` lets the effect drop a response that resolves after unmount or
  // after a re-run (baseUrl/authToken change), so a stale payload can't overwrite
  // current state. React 18 no longer warns on setState-after-unmount — it's a
  // silent no-op — so the guard is about correctness, not the warning.
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
        // Tolerate missing/non-usable fields — a legacy backend that omits any
        // of them leaves that value at its "unavailable" default rather than
        // showing a bogus value.
        setVersion(usableString(body.version));
        setSandboxUrl(usableString(body.sandboxUrl));
        // Only an explicit `false` makes the list read-only; a missing field
        // (legacy backend) stays writable.
        setWritable(body.writable !== false);
      } catch {
        // Network error / aborted fetch: leave every field at its default
        // (version/sandboxUrl undefined, writable true).
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

  return { version, sandboxUrl, writable, loading };
}
