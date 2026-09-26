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
import { setOwnEntry, getOwnEntry } from "../storage/own-entry.js";
import type { IdpSessionState } from "./storage.js";
import type { ServerOAuthState } from "./store.js";

export const OAUTH_PERSIST_STORAGE_KEY = "mcp-inspector-oauth";

/**
 * Store id the remote OAuth persist backend targets (`/api/storage/oauth`).
 * The server's storage route keys its OAuth-specific handling (secret split,
 * sectioned merges) off this id, so the two must agree.
 */
export const OAUTH_PERSIST_STORE_ID = "oauth";

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
    // Own-property read/write: with a `__proto__` key a plain lookup on an
    // empty map returns the inherited prototype, turning a clear into an
    // update, and a plain assignment would hit the prototype setter.
    const value = getOwnEntry(snapshot.servers, url);
    if (value === undefined) {
      delete merged.servers[url];
    } else {
      setOwnEntry(merged.servers, url, value);
    }
  }
  for (const issuer of sections.idpSessions ?? []) {
    const value = getOwnEntry(snapshot.idpSessions, issuer);
    if (value === undefined) {
      delete merged.idpSessions[issuer];
    } else {
      setOwnEntry(merged.idpSessions, issuer, value);
    }
  }
  return merged;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Parse an untrusted {@link OAuthPersistSections} value (the `sections` key
 * of a sectioned write body). Returns `null` on anything that is not the
 * exact shape — the server route must not merge on an attacker-shaped
 * descriptor, and an unknown key is rejected rather than ignored: a typo
 * like `{ server: [...] }` would otherwise merge nothing and still report
 * success, silently discarding the mutation it was supposed to persist.
 */
export function parseOAuthPersistSections(
  value: unknown,
): OAuthPersistSections | null {
  if (!isRecord(value)) {
    return null;
  }
  const sections: OAuthPersistSections = {};
  for (const key of Object.keys(value)) {
    if (key !== "servers" && key !== "idpSessions") return null;
  }
  if ("servers" in value) {
    if (!isStringArray(value.servers)) return null;
    sections.servers = value.servers;
  }
  if ("idpSessions" in value) {
    if (!isStringArray(value.idpSessions)) return null;
    sections.idpSessions = value.idpSessions;
  }
  return sections;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `servers`/`idpSessions` map: a record whose entry values are records. */
function isEntryMap(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.values(value).every(isRecord);
}

/**
 * The client-information fields the node split extracts *verbatim* into the
 * secret store (see `splitClientInformation` in oauth-secrets.ts). Every
 * other secret the split emits is `JSON.stringify`-ed first, so whatever
 * shape it holds arrives at the store as a string — these are the only
 * fields whose raw payload value reaches `SecretStore.set` unchanged.
 */
const VERBATIM_SECRET_KEYS = [
  "client_secret",
  "registration_access_token",
] as const;

/**
 * Whether a `clientInformation`-shaped value is absent, or is a record whose
 * verbatim-extracted secret fields are strings. A non-string there (say
 * `client_secret: 123` in a hand-edited file or a malformed PUT body) would
 * pass through the split into the secret store untouched — and a non-string
 * value in `secrets.json` makes the store refuse the *entire* file on every
 * later read and write, poisoning unrelated servers' credentials.
 */
function isValidClientInformation(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return VERBATIM_SECRET_KEYS.every(
    (key) => !Object.hasOwn(value, key) || typeof value[key] === "string",
  );
}

/** Validate one server entry's secret-bearing containers (see above). */
function isValidServerEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  if (!isValidClientInformation(entry.clientInformation)) return false;
  if (!isValidClientInformation(entry.preregisteredClientInformation))
    return false;
  if (entry.byIssuer !== undefined) {
    if (!isRecord(entry.byIssuer)) return false;
    for (const slot of Object.values(entry.byIssuer)) {
      if (!isRecord(slot)) return false;
      if (!isValidClientInformation(slot.clientInformation)) return false;
    }
  }
  return true;
}

/**
 * Validate and normalize the two entry maps. Absent maps default to empty;
 * anything that is not a record-of-records (an array, a string, an entry
 * whose value is a scalar) rejects the whole payload — coercing it would
 * fabricate nonsensical entries from a malformed body or file instead of
 * returning 400 / treating the file as unreadable. Entries whose
 * verbatim-extracted secret fields are not strings are rejected the same
 * way: they would otherwise poison the shared secret store (see
 * {@link isValidClientInformation}).
 */
function snapshotFromPayload(
  payload: Record<string, unknown>,
): OAuthPersistSnapshot | null {
  const servers = payload.servers ?? {};
  const idpSessions = payload.idpSessions ?? {};
  if (!isEntryMap(servers) || !isEntryMap(idpSessions)) return null;
  if (!Object.values(servers).every(isValidServerEntry)) return null;
  return {
    servers: servers as OAuthPersistSnapshot["servers"],
    idpSessions: idpSessions as OAuthPersistSnapshot["idpSessions"],
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
    return snapshotFromPayload(parsed.state);
  }

  if ("servers" in parsed || "idpSessions" in parsed) {
    return snapshotFromPayload(parsed);
  }

  return null;
}

export function serializeOAuthPersistBlob(
  snapshot: OAuthPersistSnapshot,
): string {
  return serializeStore(snapshot);
}

/**
 * A sectioned OAuth store write, parsed from an untrusted POST body.
 *
 * The descriptor travels in the request body — wrapped as
 * `{ sections, snapshot }` — not in a query parameter: sections name whole
 * server URLs, and `clearEnterpriseManagedResourceServers()` puts every
 * managed URL into one descriptor, so a URL-encoded descriptor can exceed
 * Node's request-target limit and be rejected (431) before the route runs.
 * In the body the descriptor is bounded by the route's `bodyLimit` cap
 * (`MAX_STORAGE_BODY_BYTES` in the remote server), enforced before the body
 * is buffered. A plain (non-enveloped) OAuth blob body remains a full
 * replacement.
 */
export type OAuthStoreWrite =
  | { snapshot: OAuthPersistSnapshot; sections?: undefined }
  | { snapshot: OAuthPersistSnapshot; sections: OAuthPersistSections };

export function serializeOAuthSectionedWrite(
  snapshot: OAuthPersistSnapshot,
  sections: OAuthPersistSections,
): string {
  return JSON.stringify({ sections, snapshot });
}

/**
 * Parse an OAuth store POST body: either a `{ sections, snapshot }`
 * envelope (sectioned merge) or a bare persist blob (full replacement).
 * Returns `null` when neither shape validates. A bare blob can never be
 * mistaken for an envelope — blobs only ever carry `servers` /
 * `idpSessions` (or legacy `state`/`version`) keys, never `sections`.
 */
export function parseOAuthStoreWriteBody(
  body: unknown,
): OAuthStoreWrite | null {
  // Only records can be valid writes; rejecting everything else up front
  // also keeps a JSON *string* body away from `parseOAuthPersistBlob`,
  // which would try to re-parse it as raw JSON and throw.
  if (!isRecord(body)) return null;
  if ("sections" in body) {
    // Strict envelope: any key besides `sections`/`snapshot` is a malformed
    // write, not something to skip — accepting it would let a misspelled
    // payload return 200 while persisting nothing.
    for (const key of Object.keys(body)) {
      if (key !== "sections" && key !== "snapshot") return null;
    }
    const sections = parseOAuthPersistSections(body.sections);
    if (!sections) return null;
    const snapshot = parseOAuthPersistBlob(
      "snapshot" in body ? body.snapshot : null,
    );
    if (!snapshot) return null;
    return { snapshot, sections };
  }
  const snapshot = parseOAuthPersistBlob(body);
  if (!snapshot) return null;
  return { snapshot };
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
      // sections descriptor rides in the POST body (see
      // `parseOAuthStoreWriteBody` — a query parameter would cap how many
      // sections fit under Node's request-target limit) and the route
      // overlays only the named entries onto the file, under its
      // cross-process lock. Posting the whole snapshot bare would overwrite
      // entries other processes wrote since this browser tab loaded.
      const res = await fetchFn(`${baseUrl}/api/storage/${options.storeId}`, {
        method: "POST",
        headers,
        body: sections
          ? serializeOAuthSectionedWrite(snapshot, sections)
          : serializeOAuthPersistBlob(snapshot),
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
