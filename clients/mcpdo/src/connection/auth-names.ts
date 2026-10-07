/**
 * Friendly-name resolution for the URL-keyed OAuth store.
 *
 * The OAuth store is identified by server URL (the credential *is* the URL, and
 * `oauth.json` is shared by every client sharing a config dir). Catalog entries
 * (`mcp.json`, per-shell) and live daemon connections (daemon-global) each carry
 * a user-chosen *name* for the same URL, so this module builds the two-way map
 * between them: `auth/list` annotates each stored URL with the names it is
 * `knownAs`, and `auth/clear` accepts a name as an alternate to the raw URL.
 *
 * Both functions here are pure — the caller fetches the catalog entries
 * (`listServerEntries`) and the daemon's connection list (`connections/list`)
 * and passes them in, so this stays trivially unit-testable with no daemon or
 * filesystem. URL canonicalisation is the *same* `normalizeServerUrl` the store
 * resolves keys with, so a catalog `https://api.example.com/mcp` and the store's
 * `new URL(...).href` key line up.
 */
import type { ServerListEntry } from "@inspector/core/cli/handlers/servers-list.js";
import type { ConnectionInfo } from "../daemon/protocol.js";
import { normalizeServerUrl } from "./stored-auth.js";

/** A friendly name that points at a stored server URL. */
export type AuthNameRef = {
  name: string;
  /** Where the name came from — a catalog entry or a live daemon connection. */
  source: "catalog" | "connection";
  /** True when this name is a currently-open connection. */
  isLive: boolean;
};

export type AuthNameIndex = {
  /** Normalised URL → the friendly names that resolve to it (0..n). */
  urlToNames: Map<string, AuthNameRef[]>;
  /** Friendly name → the normalised URL(s) it maps to (usually exactly one). */
  nameToUrls: Map<string, Set<string>>;
  /**
   * Every catalog/connection name seen, *including* stdio ones that have no
   * URL — lets `auth/clear <name>` tell "known server, just no stored auth"
   * (stdio) from "no such name" (typo).
   */
  knownNames: Set<string>;
};

/** Only http(s) identities have a URL-keyed OAuth entry. */
function urlIfHttp(value: string | undefined): string | undefined {
  if (value && /^https?:\/\//i.test(value)) return normalizeServerUrl(value);
  return undefined;
}

/**
 * Build the two-way name↔URL index from catalog entries and live connections.
 * A connection and a catalog entry that share a name and URL collapse to one
 * `AuthNameRef` (with `isLive: true`) rather than listing the name twice.
 */
export function buildAuthNameIndex(
  entries: ServerListEntry[],
  connections: ConnectionInfo[],
): AuthNameIndex {
  const urlToNames = new Map<string, AuthNameRef[]>();
  const nameToUrls = new Map<string, Set<string>>();
  const knownNames = new Set<string>();

  const add = (
    name: string,
    url: string | undefined,
    source: AuthNameRef["source"],
    isLive: boolean,
  ): void => {
    knownNames.add(name);
    if (!url) return;
    let urls = nameToUrls.get(name);
    if (!urls) {
      urls = new Set<string>();
      nameToUrls.set(name, urls);
    }
    urls.add(url);

    let refs = urlToNames.get(url);
    if (!refs) {
      refs = [];
      urlToNames.set(url, refs);
    }
    const existing = refs.find((r) => r.name === name);
    if (existing) {
      // Same (name, url) from both catalog and connection: keep one ref and
      // let the live flag win, since a live connection is the stronger fact.
      if (isLive) existing.isLive = true;
      return;
    }
    refs.push({ name, source, isLive });
  };

  // Catalog entries: `detail` is the URL for sse/streamable-http, a command
  // line for stdio (no URL-keyed entry).
  for (const entry of entries) {
    add(entry.name, urlIfHttp(entry.detail), "catalog", false);
  }

  // Live connections (daemon-global) catch ad-hoc connects the per-shell
  // catalog never had an entry for.
  for (const conn of connections) {
    add(conn.name, urlIfHttp(conn.serverIdentity), "connection", true);
  }

  return index(urlToNames, nameToUrls, knownNames);
}

/** Sort each URL's names (live first, then alphabetical) for stable output. */
function index(
  urlToNames: Map<string, AuthNameRef[]>,
  nameToUrls: Map<string, Set<string>>,
  knownNames: Set<string>,
): AuthNameIndex {
  for (const refs of urlToNames.values()) {
    refs.sort(
      (a, b) =>
        Number(b.isLive) - Number(a.isLive) || a.name.localeCompare(b.name),
    );
  }
  return { urlToNames, nameToUrls, knownNames };
}

/** The outcome of resolving a friendly name to a store URL. */
export type AuthNameResolution =
  | { kind: "url"; url: string }
  | { kind: "no-url"; name: string }
  | { kind: "ambiguous"; name: string; urls: string[] }
  | { kind: "unknown"; name: string };

/**
 * Resolve a friendly (non-URL) `auth/clear` argument against the index.
 *
 * - `url`: the name maps to exactly one store URL — clear it.
 * - `no-url`: a known catalog/connection name with no URL (stdio) — nothing to
 *   clear, but not an error worth a non-zero typo message.
 * - `ambiguous`: the name maps to two *different* URLs (a catalog entry and a
 *   live ad-hoc connection that share a name but point elsewhere) — the one
 *   genuine collision; ask for the explicit URL.
 * - `unknown`: no such name anywhere.
 *
 * Two names sharing one URL is *not* ambiguous: both resolve to the same
 * credential and clearing is idempotent.
 */
export function resolveFriendlyName(
  name: string,
  index: AuthNameIndex,
): AuthNameResolution {
  const urls = index.nameToUrls.get(name);
  if (urls && urls.size === 1) {
    return { kind: "url", url: [...urls][0] };
  }
  if (urls && urls.size > 1) {
    return { kind: "ambiguous", name, urls: [...urls].sort() };
  }
  if (index.knownNames.has(name)) {
    return { kind: "no-url", name };
  }
  return { kind: "unknown", name };
}
