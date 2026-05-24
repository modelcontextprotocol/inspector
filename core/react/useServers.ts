/**
 * React hook over the `/api/servers` endpoints. Fetches the list on mount,
 * holds it in local state, and exposes addServer / updateServer / removeServer
 * mutators that round-trip through the backend (re-fetching after each write
 * to stay in sync with the on-disk truth).
 */

import { useCallback, useEffect, useState } from "react";
import { mcpConfigToServerEntries } from "../mcp/serverList.js";
import type {
  InspectorServerSettings,
  MCPConfig,
  MCPServerConfig,
  ServerEntry,
} from "../mcp/types.js";

export interface UseServersOptions {
  /** Base URL of the remote server (typically `window.location.origin`). */
  baseUrl: string;
  /** Optional auth token for the `x-mcp-remote-auth` header. */
  authToken?: string;
  /** Fetch function to use (default: globalThis.fetch). Useful in tests. */
  fetchFn?: typeof fetch;
}

export interface UseServersResult {
  servers: ServerEntry[];
  loading: boolean;
  error: string | undefined;
  refresh: () => Promise<void>;
  addServer: (id: string, config: MCPServerConfig) => Promise<void>;
  updateServer: (
    originalId: string,
    newId: string,
    config: MCPServerConfig,
  ) => Promise<void>;
  /**
   * Patch only the `settings` node on an existing server entry, leaving the
   * transport config and id untouched. Routes through `PUT /api/servers/:id`
   * with the current `config` plus the new settings.
   */
  updateServerSettings: (
    id: string,
    settings: InspectorServerSettings,
  ) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
}

function buildHeaders(
  authToken: string | undefined,
  includeJsonBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeJsonBody) headers["Content-Type"] = "application/json";
  if (authToken) headers["x-mcp-remote-auth"] = `Bearer ${authToken}`;
  return headers;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string") return body.error;
  } catch {
    /* ignore */
  }
  return `HTTP ${res.status}`;
}

export function useServers(opts: UseServersOptions): UseServersResult {
  const { baseUrl, authToken, fetchFn } = opts;
  const doFetch = fetchFn ?? globalThis.fetch;
  // Normalize once — saves us from re-string-munging on every mutator call.
  const base = baseUrl.replace(/\/$/, "");

  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await doFetch(`${base}/api/servers`, {
        method: "GET",
        headers: buildHeaders(authToken, false),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      const body = (await res.json()) as MCPConfig;
      setServers(mcpConfigToServerEntries(body));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [base, authToken, doFetch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addServer = useCallback(
    async (id: string, config: MCPServerConfig): Promise<void> => {
      const res = await doFetch(`${base}/api/servers`, {
        method: "POST",
        headers: buildHeaders(authToken, true),
        body: JSON.stringify({ id, config }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      await refresh();
    },
    [base, authToken, doFetch, refresh],
  );

  const updateServer = useCallback(
    async (
      originalId: string,
      newId: string,
      config: MCPServerConfig,
    ): Promise<void> => {
      // `settings` is intentionally omitted from the body. The backend route
      // treats omission as "preserve the existing settings node on disk", so
      // a config-only save (e.g. ServerConfigModal) cannot silently wipe
      // persisted headers / metadata / OAuth credentials. To explicitly
      // clear settings, send `settings: null`.
      const res = await doFetch(
        `${base}/api/servers/${encodeURIComponent(originalId)}`,
        {
          method: "PUT",
          headers: buildHeaders(authToken, true),
          body: JSON.stringify({ id: newId, config }),
        },
      );
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      await refresh();
    },
    [base, authToken, doFetch, refresh],
  );

  const updateServerSettings = useCallback(
    async (id: string, settings: InspectorServerSettings): Promise<void> => {
      const existing = servers.find((s) => s.id === id);
      if (!existing) {
        throw new Error(`Server '${id}' not found`);
      }
      const res = await doFetch(
        `${base}/api/servers/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: buildHeaders(authToken, true),
          body: JSON.stringify({
            id,
            config: existing.config,
            settings,
          }),
        },
      );
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      await refresh();
    },
    [base, authToken, doFetch, refresh, servers],
  );

  const removeServer = useCallback(
    async (id: string): Promise<void> => {
      const res = await doFetch(
        `${base}/api/servers/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: buildHeaders(authToken, false),
        },
      );
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      await refresh();
    },
    [base, authToken, doFetch, refresh],
  );

  return {
    servers,
    loading,
    error,
    refresh,
    addServer,
    updateServer,
    updateServerSettings,
    removeServer,
  };
}
