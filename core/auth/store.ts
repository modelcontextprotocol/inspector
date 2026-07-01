/**
 * OAuth store factory using Zustand.
 * Creates a store with any storage adapter (file, remote, sessionStorage).
 */

import { createStore } from "zustand/vanilla";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  IdpSessionState,
  OAuthClientRegistrationKind,
} from "./storage.js";

/**
 * OAuth state for a single server
 */
export interface ServerOAuthState {
  clientInformation?: OAuthClientInformation;
  /** Set when {@link clientInformation} is saved — DCR vs CIMD. */
  clientRegistrationKind?: OAuthClientRegistrationKind;
  preregisteredClientInformation?: OAuthClientInformation;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  scope?: string;
  serverMetadata?: OAuthMetadata;
  /** Set when resource tokens were minted via EMA (legs 2–3). */
  enterpriseManaged?: boolean;
}

/**
 * Normalize a server URL to its canonical form for use as a store key.
 *
 * Different callers (web deep-link parser, CLI `--server-url`, the SDK's own
 * client constructor) can present the same endpoint with cosmetic differences
 * — host case, a trailing slash on a bare-origin URL, default-port omission —
 * that `new URL().href` collapses. Keying by the canonical form means a token
 * the web inspector saved under `https://Example.com/mcp` is found when the
 * CLI later asks for `https://example.com/mcp/`. Non-URL strings (e.g. a
 * stdio server name) are returned trimmed so the store still works for them.
 */
export function normalizeServerUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim();
  try {
    return new URL(trimmed).href;
  } catch {
    return trimmed;
  }
}

/**
 * Zustand store state (all servers)
 */
export interface OAuthStoreState {
  servers: Record<string, ServerOAuthState>;
  idpSessions: Record<string, IdpSessionState>;
  getServerState: (serverUrl: string) => ServerOAuthState;
  setServerState: (serverUrl: string, state: Partial<ServerOAuthState>) => void;
  clearServerState: (serverUrl: string) => void;
  getIdpSession: (issuer: string) => IdpSessionState;
  setIdpSession: (issuer: string, updates: Partial<IdpSessionState>) => void;
  clearIdpSession: (issuer: string) => void;
  clearEnterpriseManagedResourceServers: () => void;
}

/**
 * Creates a Zustand store for OAuth state with the given storage adapter.
 * The storage adapter handles persistence (file, remote HTTP, sessionStorage, etc.).
 *
 * @param storage - Zustand storage adapter (from createJSONStorage)
 * @returns Zustand store instance
 */
export function createOAuthStore(
  storage: ReturnType<typeof createJSONStorage>,
) {
  return createStore<OAuthStoreState>()(
    persist(
      (set, get) => ({
        servers: {},
        idpSessions: {},
        getServerState: (serverUrl: string) => {
          const servers = get().servers;
          // Look up by canonical key, falling back to the raw key so an
          // already-persisted blob written before normalization existed (or by
          // another writer) is still found.
          return (
            servers[normalizeServerUrl(serverUrl)] ?? servers[serverUrl] ?? {}
          );
        },
        setServerState: (
          serverUrl: string,
          updates: Partial<ServerOAuthState>,
        ) => {
          const key = normalizeServerUrl(serverUrl);
          set((state) => {
            const servers = { ...state.servers };
            // Mirror getServerState's canonical→raw fallback for writes: if no
            // canonical entry exists yet but a pre-normalization blob lives
            // under the raw key, migrate it onto the canonical key so this
            // partial write MERGES onto the existing credential instead of
            // shadowing it with a fresh canonical entry (which would orphan the
            // raw-key blob's other fields — e.g. a token — behind the new
            // canonical one that getServerState now prefers).
            let base = servers[key];
            if (base === undefined && servers[serverUrl] !== undefined) {
              // Reaching here implies `serverUrl !== key`: if they were equal,
              // `servers[serverUrl]` would equal the `servers[key]` we just
              // found undefined, so the guard above could not have passed.
              base = servers[serverUrl];
              delete servers[serverUrl];
            }
            servers[key] = { ...base, ...updates };
            return { servers };
          });
        },
        clearServerState: (serverUrl: string) => {
          const key = normalizeServerUrl(serverUrl);
          set((state) => {
            const rest = { ...state.servers };
            delete rest[key];
            // Also drop a pre-normalization blob under the raw key so a clear
            // fully removes the credential rather than leaving an orphan that
            // getServerState's raw-key fallback would keep surfacing.
            if (serverUrl !== key) delete rest[serverUrl];
            return { servers: rest };
          });
        },
        getIdpSession: (issuer: string) => {
          return get().idpSessions[issuer] || {};
        },
        setIdpSession: (issuer: string, updates: Partial<IdpSessionState>) => {
          set((state) => ({
            idpSessions: {
              ...state.idpSessions,
              [issuer]: {
                ...state.idpSessions[issuer],
                ...updates,
              },
            },
          }));
        },
        clearIdpSession: (issuer: string) => {
          set((state) => {
            const rest = { ...state.idpSessions };
            delete rest[issuer];
            return { idpSessions: rest };
          });
        },
        clearEnterpriseManagedResourceServers: () => {
          set((state) => {
            const rest = { ...state.servers };
            for (const [url, serverState] of Object.entries(state.servers)) {
              if (serverState.enterpriseManaged === true) {
                delete rest[url];
              }
            }
            return { servers: rest };
          });
        },
      }),
      {
        name: "mcp-inspector-oauth",
        storage,
        // OAuthStorageBase drives `persist.rehydrate()` itself so it can await
        // (and catch errors from) the single hydration. Auto-hydration here
        // would race the explicit one and could clobber a save that landed
        // between them.
        skipHydration: true,
      },
    ),
  );
}
