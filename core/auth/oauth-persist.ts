/**
 * OAuth persistence format and backends (file, remote HTTP, sessionStorage).
 * Writes plain JSON `{ servers, idpSessions }`. On read, accepts legacy
 * persist envelopes `{ state: { servers, idpSessions }, version }` and
 * promotes the inner payload.
 */

import {
  readStoreFile,
  writeStoreFile,
  deleteStoreFile,
  serializeStore,
  parseStore,
} from "../storage/store-io.js";
import type { IdpSessionState } from "./storage.js";
import type { ServerOAuthState } from "./store.js";

export const OAUTH_PERSIST_STORAGE_KEY = "mcp-inspector-oauth";

export interface OAuthPersistSnapshot {
  servers: Record<string, ServerOAuthState>;
  idpSessions: Record<string, IdpSessionState>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotFromPayload(payload: Partial<OAuthPersistSnapshot>): OAuthPersistSnapshot {
  return {
    servers: payload.servers ?? {},
    idpSessions: payload.idpSessions ?? {},
  };
}

/**
 * Parse OAuth store JSON from disk, remote API, or sessionStorage.
 * Accepts plain `{ servers, idpSessions }` or legacy `{ state, version }`.
 */
export function parseOAuthPersistBlob(
  raw: string | null,
): OAuthPersistSnapshot | null {
  if (!raw) {
    return null;
  }
  const parsed = parseStore(raw);
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
  write(snapshot: OAuthPersistSnapshot): Promise<void>;
  remove?(): Promise<void>;
}

export interface FileOAuthPersistBackendOptions {
  filePath: string;
}

export function createFileOAuthPersistBackend(
  options: FileOAuthPersistBackendOptions,
): OAuthPersistBackend {
  return {
    async read() {
      const raw = await readStoreFile(options.filePath);
      return parseOAuthPersistBlob(raw);
    },
    async write(snapshot) {
      await writeStoreFile(
        options.filePath,
        serializeOAuthPersistBlob(snapshot),
      );
    },
    async remove() {
      await deleteStoreFile(options.filePath);
    },
  };
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

      const store = await res.json();
      if (Object.keys(store as object).length === 0) {
        return null;
      }
      return parseOAuthPersistBlob(JSON.stringify(store));
    },
    async write(snapshot) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (options.authToken) {
        headers["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
      }

      const res = await fetchFn(`${baseUrl}/api/storage/${options.storeId}`, {
        method: "POST",
        headers,
        body: serializeOAuthPersistBlob(snapshot),
      });

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
