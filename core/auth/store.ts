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

/**
 * OAuth state for a single server
 */
export interface ServerOAuthState {
  clientInformation?: OAuthClientInformation;
  preregisteredClientInformation?: OAuthClientInformation;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  scope?: string;
  serverMetadata?: OAuthMetadata;
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
  getServerState: (serverUrl: string) => ServerOAuthState;
  setServerState: (serverUrl: string, state: Partial<ServerOAuthState>) => void;
  clearServerState: (serverUrl: string) => void;
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
          set((state) => ({
            servers: {
              ...state.servers,
              [key]: {
                ...state.servers[key],
                ...updates,
              },
            },
          }));
        },
        clearServerState: (serverUrl: string) => {
          const key = normalizeServerUrl(serverUrl);
          set((state) => {
            const rest = { ...state.servers };
            delete rest[key];
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
