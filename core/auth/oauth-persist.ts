/**
 * OAuth persistence format and isomorphic backends (remote HTTP,
 * sessionStorage). Writes plain JSON `{ servers, idpSessions }`. On read,
 * accepts legacy persist envelopes `{ state: { servers, idpSessions },
 * version }` and promotes the inner payload.
 *
 * Also defines sectioned writes (`OAuthPersistSections` +
 * `mergeOAuthSections`): a mutation names the `servers`/`idpSessions`
 * entries it touched, and shared-store backends overlay only those entries
 * onto a fresh read — so one process's stale snapshot can't clobber entries
 * another process wrote (see `./node/oauth-persist-file.ts` and the remote
 * server's storage route for the two merge sites).
 *
 * This module must stay browser-safe: it imports only the Node-free
 * `store-serialize` helpers, never `store-io` (which pulls `node:fs`). The
 * Node-only file backend lives in `./node/oauth-persist-file.ts`.
 */

import { serializeStore, parseStore } from "../storage/store-serialize.js";
import type { IdpSessionState } from "./storage.js";
import type { ServerOAuthState } from "./store.js";

export const OAUTH_PERSIST_STORAGE_KEY = "mcp-inspector-oauth";

export interface OAuthPersistSnapshot {
  servers: Record<string, ServerOAuthState>;
  idpSessions: Record<string, IdpSessionState>;
}

/**
 * Names the sections one mutation touched, at the granularity persistence
 * merges on: whole `servers[url]` / `idpSessions[issuer]` entries.
 *
 * Every mutation on `OAuthStorageBase` is scoped to named entries (a token
 * save touches one server, an IdP login one issuer), and each one already
 * persists individually — so the write path can know exactly what changed at
 * the moment it changes. Backends that share their store with other writers
 * (the file backend; the remote backend via the server route) use this to
 * write **only** the named entries over a fresh read of the store, so a
 * process holding stale memory can no longer erase entries it never mutated
 * by flushing its whole snapshot (the last-writer-wins clobber this replaces).
 */
export interface OAuthPersistSections {
  /** Server URLs (keys of {@link OAuthPersistSnapshot.servers}) to write. */
  servers?: string[];
  /** IdP issuers (keys of {@link OAuthPersistSnapshot.idpSessions}) to write. */
  idpSessions?: string[];
}

/**
 * Overlay the named sections of `snapshot` onto `disk`, leaving every other
 * entry as the store currently has it. A named key absent from `snapshot` is
 * a deletion (the mutation was a clear), so clears propagate rather than
 * resurrect. Pure — shared by the Node file backend and the remote server
 * route so the two merge implementations cannot drift.
 */
export function mergeOAuthSections(
  disk: OAuthPersistSnapshot | null,
  snapshot: OAuthPersistSnapshot,
  sections: OAuthPersistSections,
): OAuthPersistSnapshot {
  const merged: OAuthPersistSnapshot = {
    servers: { ...disk?.servers },
    idpSessions: { ...disk?.idpSessions },
  };
  for (const url of sections.servers ?? []) {
    const value = snapshot.servers[url];
    if (value === undefined) {
      delete merged.servers[url];
    } else {
      merged.servers[url] = value;
    }
  }
  for (const issuer of sections.idpSessions ?? []) {
    const value = snapshot.idpSessions[issuer];
    if (value === undefined) {
      delete merged.idpSessions[issuer];
    } else {
      merged.idpSessions[issuer] = value;
    }
  }
  return merged;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Parse a serialized {@link OAuthPersistSections} (the remote backend sends it
 * as a query parameter). Returns `null` on anything that is not the exact
 * shape — the server route must not merge on an attacker-shaped descriptor.
 */
export function parseOAuthPersistSections(
  raw: string,
): OAuthPersistSections | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const sections: OAuthPersistSections = {};
  if ("servers" in parsed) {
    if (!isStringArray(parsed.servers)) return null;
    sections.servers = parsed.servers;
  }
  if ("idpSessions" in parsed) {
    if (!isStringArray(parsed.idpSessions)) return null;
    sections.idpSessions = parsed.idpSessions;
  }
  return sections;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotFromPayload(
  payload: Partial<OAuthPersistSnapshot>,
): OAuthPersistSnapshot {
  return {
    servers: payload.servers ?? {},
    idpSessions: payload.idpSessions ?? {},
  };
}

/**
 * Parse OAuth store JSON from disk, remote API, or sessionStorage.
 * Accepts plain `{ servers, idpSessions }` or legacy `{ state, version }`.
 * `raw` may be a JSON string or an already-parsed object (e.g. from `res.json()`).
 */
export function parseOAuthPersistBlob(
  raw: string | null | unknown,
): OAuthPersistSnapshot | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const parsed = typeof raw === "string" ? (raw ? parseStore(raw) : null) : raw;

  if (!isRecord(parsed)) {
    return null;
  }

  if (isRecord(parsed.state) && "version" in parsed) {
    return snapshotFromPayload(parsed.state as Partial<OAuthPersistSnapshot>);
  }

  if ("servers" in parsed || "idpSessions" in parsed) {
    return snapshotFromPayload(parsed as Partial<OAuthPersistSnapshot>);
  }

  return null;
}

export function serializeOAuthPersistBlob(
  snapshot: OAuthPersistSnapshot,
): string {
  return serializeStore(snapshot);
}

export interface OAuthPersistBackend {
  read(): Promise<OAuthPersistSnapshot | null>;
  /**
   * Persist `snapshot`. When `sections` is given, a backend whose store is
   * shared with other writers must write only the named entries over a fresh
   * read of the store (see {@link mergeOAuthSections}); a backend whose store
   * has a single owner (sessionStorage) may ignore it and write the snapshot
   * whole.
   */
  write(
    snapshot: OAuthPersistSnapshot,
    sections?: OAuthPersistSections,
  ): Promise<void>;
  remove?(): Promise<void>;
}

export interface RemoteOAuthPersistBackendOptions {
  baseUrl: string;
  storeId: string;
  authToken?: string;
  fetchFn?: typeof fetch;
}

export function createRemoteOAuthPersistBackend(
  options: RemoteOAuthPersistBackendOptions,
): OAuthPersistBackend {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  return {
    async read() {
      const headers: Record<string, string> = {};
      if (options.authToken) {
        headers["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
      }

      const res = await fetchFn(`${baseUrl}/api/storage/${options.storeId}`, {
        method: "GET",
        headers,
      });

      if (!res.ok) {
        if (res.status === 404) {
          return null;
        }
        throw new Error(`Failed to read store: ${res.status}`);
      }

      // parseOAuthPersistBlob already returns null for {} (the server's
      // missing-file response, server.ts) and for a literal null body, so no
      // empty-object guard is needed — and Object.keys(null) would throw.
      const store = await res.json();
      return parseOAuthPersistBlob(store);
    },
    async write(snapshot, sections) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (options.authToken) {
        headers["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
      }

      // The server holds the shared store, so the merge happens there: the
      // sections descriptor rides a query parameter and the route overlays
      // only the named entries onto the file, under its cross-process lock.
      // Posting the whole snapshot bare would overwrite entries other
      // processes wrote since this browser tab loaded.
      const sectionsQuery = sections
        ? `?sections=${encodeURIComponent(JSON.stringify(sections))}`
        : "";
      const res = await fetchFn(
        `${baseUrl}/api/storage/${options.storeId}${sectionsQuery}`,
        {
          method: "POST",
          headers,
          body: serializeOAuthPersistBlob(snapshot),
        },
      );

      if (!res.ok) {
        throw new Error(`Failed to write store: ${res.status}`);
      }
    },
    async remove() {
      const headers: Record<string, string> = {};
      if (options.authToken) {
        headers["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
      }

      const res = await fetchFn(`${baseUrl}/api/storage/${options.storeId}`, {
        method: "DELETE",
        headers,
      });

      if (!res.ok && res.status !== 404) {
        throw new Error(`Failed to delete store: ${res.status}`);
      }
    },
  };
}

export interface SessionOAuthPersistBackendOptions {
  storageKey?: string;
  getStorage?: () => Storage;
}

export function createSessionOAuthPersistBackend(
  options: SessionOAuthPersistBackendOptions = {},
): OAuthPersistBackend {
  const storageKey = options.storageKey ?? OAUTH_PERSIST_STORAGE_KEY;
  const getStorage = options.getStorage ?? (() => sessionStorage);

  return {
    async read() {
      return parseOAuthPersistBlob(getStorage().getItem(storageKey));
    },
    async write(snapshot) {
      getStorage().setItem(storageKey, serializeOAuthPersistBlob(snapshot));
    },
    async remove() {
      getStorage().removeItem(storageKey);
    },
  };
}
