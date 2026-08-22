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
 * - `secretStorage` — which store this session's secrets go to (#1950),
 *   resolved on the Node side where the keychain probe happens. `undefined`
 *   until the fetch resolves and on a backend that omits it; the settings-modal
 *   footers render nothing then, because a guessed answer under a secret field
 *   is worse than no answer.
 *
 * This consolidates the three former single-field hooks (`useSandboxUrl`,
 * `useServerListWritable`, `useInspectorVersion`), each of which fetched the
 * same static payload separately, into one request (#1643).
 *
 * Fetches on mount, and re-fetches if `baseUrl` or `authToken` changes (rare —
 * effectively a full reload; the GET is idempotent). A response that resolves
 * after unmount or a re-fetch is dropped rather than overwriting current state.
 */

import { useCallback, useEffect, useState } from "react";
import type { SecretStorageInfo } from "../auth/secret-storage-info.js";

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
  /** Where this session's secrets are stored, or undefined when unknown. */
  secretStorage: SecretStorageInfo | undefined;
  /** True while the initial fetch is in flight. */
  loading: boolean;
}

/** Minimal shape we read from the `/api/config` payload. */
interface ConfigPayload {
  version?: unknown;
  sandboxUrl?: unknown;
  writable?: unknown;
  secretStorage?: unknown;
}

/**
 * Narrow the payload's `secretStorage` before trusting it.
 *
 * The footer states, in the UI, where a user's secret is about to go, so a
 * malformed or partial descriptor must render as "unknown" rather than as a
 * confident half-answer.
 *
 * Every field the footer reads is checked, not just `kind`. A partial
 * `{ kind: "file" }` would otherwise pass, and because a missing `plaintext`
 * is falsy it would render as the quiet, neutral *encrypted* file — the
 * single most misleading thing this component can say, produced by the
 * absence of information rather than by any claim the backend made. Each
 * kind's own required fields are checked for the same reason: a file store
 * with no `path` cannot answer the question a file store exists to answer.
 */
function usableSecretStorage(value: unknown): SecretStorageInfo | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (v.kind !== "keyring" && v.kind !== "file" && v.kind !== "memory") {
    return undefined;
  }
  if (
    v.reason !== "configured" &&
    v.reason !== "default" &&
    v.reason !== "fallback"
  ) {
    return undefined;
  }
  if (typeof v.durable !== "boolean") return undefined;
  if (v.kind === "file") {
    if (typeof v.path !== "string" || v.path === "") return undefined;
    // Exactly one of the two must be present: either we know the encryption
    // state, or we know we could not read it. A descriptor carrying neither
    // (or both) was not built by a backend we understand, and the footer
    // would have to invent the missing half.
    const knowsEncryption = typeof v.plaintext === "boolean";
    const knowsItCannotRead = typeof v.encryptionUnknown === "string";
    if (knowsEncryption === knowsItCannotRead) return undefined;
    if (v.encryptionUnknown !== undefined && !knowsItCannotRead) {
      return undefined;
    }
    // Optional, so absent is fine — but a *present* value must be a real
    // boolean. `pendingEncryption: "false"` is a truthy string, and the
    // footer would read it as "already re-encrypting" and print advice that
    // is the opposite of the truth.
    if (
      v.pendingEncryption !== undefined &&
      typeof v.pendingEncryption !== "boolean"
    ) {
      return undefined;
    }
    if (v.looseMode !== undefined && typeof v.looseMode !== "number") {
      return undefined;
    }
    if (
      v.permissionsUnknown !== undefined &&
      typeof v.permissionsUnknown !== "string"
    ) {
      return undefined;
    }
  } else if (
    // File-only fields on a keychain or memory descriptor mean the payload
    // was not built by a backend we understand. Rejecting is cheap and the
    // alternative is rendering a mixture of two stores' answers.
    v.path !== undefined ||
    v.plaintext !== undefined ||
    v.pendingEncryption !== undefined ||
    v.looseMode !== undefined ||
    v.permissionsUnknown !== undefined ||
    v.encryptionUnknown !== undefined
  ) {
    return undefined;
  }
  return value as SecretStorageInfo;
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
  const [secretStorage, setSecretStorage] = useState<
    SecretStorageInfo | undefined
  >(undefined);
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
        setSecretStorage(usableSecretStorage(body.secretStorage));
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

  return { version, sandboxUrl, writable, secretStorage, loading };
}
