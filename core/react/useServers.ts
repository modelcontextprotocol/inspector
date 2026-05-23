/**
 * React hook over the `/api/servers` endpoints. Fetches the list on mount,
 * holds it in local state, and exposes addServer / updateServer / removeServer
 * mutators that round-trip through the backend (re-fetching after each write
 * to stay in sync with the on-disk truth).
 */

import { useCallback, useEffect, useState } from "react";
import { mcpConfigToServerEntries } from "../mcp/serverList.js";
import type {
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
    removeServer,
  };
}
