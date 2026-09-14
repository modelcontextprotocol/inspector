/**
 * React hook over the `/api/servers` endpoints. Fetches the list on mount,
 * holds it in local state, and exposes addServer / updateServer / removeServer
 * mutators that round-trip through the backend (re-fetching after each write
 * to stay in sync with the on-disk truth).
 */

import { useCallback, useEffect, useState } from "react";
import { mcpConfigToServerEntries } from "../mcp/serverList.js";
import type { ImportSourceResult } from "../mcp/import/types.js";
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
  /**
   * Persist a new ordering for the server list. `orderedIds` must be the
   * complete set of current server ids in the desired order. The local list
   * is reordered optimistically so the grid reflows instantly; on backend
   * failure (e.g. the on-disk set changed underneath us) we re-fetch to snap
   * back to disk truth. Routes through `PUT /api/servers/order`.
   */
  reorderServers: (orderedIds: string[]) => Promise<void>;
  /**
   * Read another MCP client's well-known config on the backend host and return
   * its servers in canonical form (#1348). `type` is an import-strategy id
   * (e.g. "claude-desktop"). Used by the "Import config" source picker; the
   * resulting servers are written via `addServer` / `updateServer`.
   */
  importSource: (type: string) => Promise<ImportSourceResult>;
}

/**
 * Thrown when a mutation's *write* landed but reading the list back
 * afterwards failed — see `refreshAfterWrite`.
 *
 * Distinct from a rejected write because the two call for opposite handling
 * in an optimistic caller. The pagination toggle in `App.tsx` reverts its
 * optimistic override and rolls the live client back on a rejection, which is
 * right for a failed PUT and wrong here: the setting *is* on disk, so the
 * rollback would show the user a value that no longer matches it. Callers
 * that update optimistically must branch on this; callers that only report
 * (the modals) can treat it as any other error.
 */
export class ServerListReloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ServerListReloadError";
  }
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

/**
 * Whether an SSE frame carries an actual event rather than only comment
 * lines. The backend primes each stream with an inert `:` comment so a
 * streaming `fetch()` resolves on Firefox at all (#1858); that frame must
 * not be mistaken for a change notification.
 */
function isSseDataFrame(frame: string): boolean {
  return frame
    .split(SSE_LINE_SEPARATOR)
    .some((line) => line.startsWith("event:") || line.startsWith("data:"));
}

/**
 * SSE line terminators. The spec permits CRLF, LF, and a bare CR; we accept
 * the first two. A bare CR is deliberately excluded because it can't be told
 * apart from the first half of a CRLF that straddles a chunk boundary — a
 * buffer ending in `…\r\n\r` would look like a completed frame and the `\n`
 * arriving in the next chunk would be mis-read as the start of another. No
 * SSE producer in the wild emits bare-CR frames, so the ambiguity buys
 * nothing.
 *
 * A frame ends at a blank line, i.e. two terminators back to back.
 */
const SSE_LINE_SEPARATOR = /\r\n|\n/;
const SSE_FRAME_SEPARATOR = /(?:\r\n|\n){2}/;

/**
 * Locates the next frame boundary in `buffer`. Returns the frame's end offset
 * and the length of the blank-line separator that terminated it (2–4 chars,
 * depending on which terminators the server used), or `null` when the buffer
 * holds no complete frame yet.
 */
function findSseFrameEnd(
  buffer: string,
): { end: number; separatorLength: number } | null {
  const match = SSE_FRAME_SEPARATOR.exec(buffer);
  if (!match) return null;
  return { end: match.index, separatorLength: match[0].length };
}

export function useServers(opts: UseServersOptions): UseServersResult {
  const { baseUrl, authToken, fetchFn } = opts;
  const doFetch = fetchFn ?? globalThis.fetch;
  // Normalize once — saves us from re-string-munging on every mutator call.
  const base = baseUrl.replace(/\/$/, "");

  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);

  // The list read itself, throwing on failure. Every refresh path goes
  // through it; they differ only in what they do with a rejection.
  const loadServers = useCallback(async (): Promise<ServerEntry[]> => {
    const res = await doFetch(`${base}/api/servers`, {
      method: "GET",
      headers: buildHeaders(authToken, false),
    });
    if (!res.ok) {
      throw new Error(await readErrorMessage(res));
    }
    const body = (await res.json()) as MCPConfig;
    return mcpConfigToServerEntries(body);
  }, [base, authToken, doFetch]);

  // Inner refresh that the public `refresh` and the SSE-triggered background
  // refresh both share. `background` skips the loading-state toggle so
  // consumers rendering a spinner or skeleton don't flash on every external
  // mcp.json edit — the existing list stays on screen while the re-fetch
  // resolves. `error` is still reset / set either way so a real error
  // surfaces even from a background refresh.
  //
  // A failure is recorded in `error` and NOT rethrown: the two callers are
  // the mount effect and the SSE loop, neither of which has anywhere to put
  // a rejection. Post-write reloads use `refreshAfterWrite` instead.
  const refreshInternal = useCallback(
    async (background: boolean): Promise<void> => {
      if (!background) setLoading(true);
      setError(undefined);
      try {
        setServers(await loadServers());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!background) setLoading(false);
      }
    },
    [loadServers],
  );

  // Post-write reload, used by every mutator. Unlike `refreshInternal` it
  // rethrows, because a mutator's caller learns that something went wrong
  // only from a rejection — `ServerConfigModal` renders `submitError` for a
  // thrown error and nothing else, so a successful POST followed by a failed
  // GET closed the Add Server modal as though the whole thing had worked
  // (#1914). The reported failure was silent for exactly this reason.
  //
  // The message says the write landed, because it did: only reading the list
  // back failed. A bare "could not add server" would send the user straight
  // into a retry that trips the duplicate-id check, which is the dead end the
  // original report described.
  //
  // The rejection is a `ServerListReloadError` rather than a bare `Error` so
  // an optimistic caller can tell it from a failed write and skip its
  // rollback — reverting here would contradict what is actually on disk.
  const refreshAfterWrite = useCallback(
    async (verb: string): Promise<void> => {
      setLoading(true);
      setError(undefined);
      try {
        setServers(await loadServers());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw new ServerListReloadError(
          `The server was ${verb}, but the server list could not be reloaded: ${message}`,
          { cause: err },
        );
      } finally {
        setLoading(false);
      }
    },
    [loadServers],
  );

  const refresh = useCallback(
    (): Promise<void> => refreshInternal(false),
    [refreshInternal],
  );

  useEffect(() => {
    // Loading the server list from the backend is the external-system
    // synchronization this effect is for, and every list/error commit happens
    // after `loadServers()` resolves. `set-state-in-effect` follows the call
    // without modelling the `await`, so it reports the whole shape. The
    // synchronous part is the pair that *opens* a load — `setLoading(true)`
    // and clearing a stale error — which settles in one extra render, and is
    // the point of having a loading flag at all.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load of an external list
    void refresh();
  }, [refresh]);

  // Subscribe to `/api/servers/events` so external edits to mcp.json
  // (the user editing the file by hand, or `mcp.json` written by another
  // tool) propagate without a manual page refresh. We deliberately use
  // fetch() + ReadableStream rather than EventSource because EventSource
  // can't send the existing `x-mcp-remote-auth: Bearer …` header — the
  // backend's auth contract is unchanged. The event payload itself is
  // ignored: any signal triggers a re-fetch, since the GET handler is the
  // sole source of truth for the list shape.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await doFetch(`${base}/api/servers/events`, {
          method: "GET",
          headers: buildHeaders(authToken, false),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // SSE frames are separated by a blank line — LF- or CRLF-terminated,
        // both of which the spec permits and `findSseFrameEnd` accepts (#2006).
        // We don't parse
        // the event type or data — `refreshInternal()` re-fetches the
        // canonical state regardless — so we just count frames and fire a
        // single background refresh per decode chunk. Two `change`
        // broadcasts landing in the same chunk become one re-fetch instead
        // of two concurrent ones whose setState order is unspecified.
        // Frames carrying no `event:`/`data:` field are skipped: the backend
        // opens the stream with an inert `:` comment frame so Firefox
        // resolves this fetch at all (see SSE_PRIMING_COMMENT in the remote
        // server), and that must not read as a change.
        // Cross-chunk debounce is not added: `awaitWriteFinish`'s 100ms
        // stability threshold already serializes external edits at the
        // source, and chained fetches against the same GET endpoint are
        // idempotent enough that a rare back-to-back pair just costs one
        // extra round-trip.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sawFrame = false;
          let boundary = findSseFrameEnd(buffer);
          while (boundary !== null) {
            const frame = buffer.slice(0, boundary.end);
            buffer = buffer.slice(boundary.end + boundary.separatorLength);
            if (isSseDataFrame(frame)) sawFrame = true;
            boundary = findSseFrameEnd(buffer);
          }
          if (sawFrame) void refreshInternal(true);
        }
      } catch {
        // AbortError on unmount, or a transient network blip. No reconnect:
        // a real failure leaves the hook in last-known-good state and the
        // user can hit refresh manually. The dev-tool reload story is fine.
      }
    })();
    return () => controller.abort();
  }, [base, authToken, doFetch, refreshInternal]);

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
      await refreshAfterWrite("added");
    },
    [base, authToken, doFetch, refreshAfterWrite],
  );

  const importSource = useCallback(
    async (type: string): Promise<ImportSourceResult> => {
      const res = await doFetch(
        `${base}/api/import-source?type=${encodeURIComponent(type)}`,
        { headers: buildHeaders(authToken, false) },
      );
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      return (await res.json()) as ImportSourceResult;
    },
    [base, authToken, doFetch],
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
      await refreshAfterWrite("saved");
    },
    [base, authToken, doFetch, refreshAfterWrite],
  );

  const updateServerSettings = useCallback(
    async (id: string, settings: InspectorServerSettings): Promise<void> => {
      // Settings-only PUT — we deliberately omit `config` so the route
      // preserves the on-disk transport config inside its write lock.
      // Reading `existing.config` from in-memory `servers` here would pin a
      // stale snapshot at scheduling time and could silently revert a
      // separate concurrent edit (e.g. a future file-watcher refreshing
      // `servers` between debounce schedule and flush). The server is the
      // single source of truth for config.
      const res = await doFetch(
        `${base}/api/servers/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: buildHeaders(authToken, true),
          body: JSON.stringify({ id, settings }),
        },
      );
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      await refreshAfterWrite("saved");
    },
    [base, authToken, doFetch, refreshAfterWrite],
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
      await refreshAfterWrite("removed");
    },
    [base, authToken, doFetch, refreshAfterWrite],
  );

  const reorderServers = useCallback(
    async (orderedIds: string[]): Promise<void> => {
      // Optimistic reorder: rebuild the local list in the requested order so
      // the grid reflows immediately, before the round-trip resolves. Built
      // from a lookup off the previous state (inside the setter) so we never
      // capture a stale snapshot, and any id not currently present is simply
      // skipped rather than producing an `undefined` hole.
      setServers((prev) => {
        const byId = new Map(prev.map((s) => [s.id, s]));
        const reordered = orderedIds
          .map((id) => byId.get(id))
          .filter((s): s is ServerEntry => s !== undefined);
        // Defensive: if the requested order dropped any entries (shouldn't
        // happen — callers pass the full set), keep the strays at the end so
        // nothing vanishes from the UI before the refresh reconciles.
        if (reordered.length !== prev.length) {
          const seen = new Set(orderedIds);
          for (const s of prev) if (!seen.has(s.id)) reordered.push(s);
        }
        return reordered;
      });
      try {
        const res = await doFetch(`${base}/api/servers/order`, {
          method: "PUT",
          headers: buildHeaders(authToken, true),
          body: JSON.stringify({ order: orderedIds }),
        });
        if (!res.ok) {
          throw new Error(await readErrorMessage(res));
        }
      } catch (err) {
        // Revert to disk truth — the optimistic order may not have landed.
        await refresh();
        throw err instanceof Error ? err : new Error(String(err));
      }
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
    reorderServers,
    importSource,
  };
}
