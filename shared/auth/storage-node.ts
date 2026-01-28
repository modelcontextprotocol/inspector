import { createStore } from "zustand/vanilla";
import { persist, createJSONStorage } from "zustand/middleware";
import type { OAuthStorage } from "./storage.js";
import type {
  OAuthClientInformation,
  OAuthTokens,
  OAuthMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * OAuth state for a single server
 */
interface ServerOAuthState {
  clientInformation?: OAuthClientInformation;
  preregisteredClientInformation?: OAuthClientInformation;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  scope?: string;
  serverMetadata?: OAuthMetadata;
}

/**
 * Zustand store state (all servers)
 */
interface OAuthStoreState {
  servers: Record<string, ServerOAuthState>;
  getServerState: (serverUrl: string) => ServerOAuthState;
  setServerState: (serverUrl: string, state: Partial<ServerOAuthState>) => void;
  clearServerState: (serverUrl: string) => void;
}

/**
 * Get path to state.json file
 */
function getStateFilePath(): string {
  // Default to ~/.mcp-inspector/oauth/state.json
  const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
  return path.join(homeDir, ".mcp-inspector", "oauth", "state.json");
}

/**
 * Create Zustand store with persist middleware
 * Uses file-based storage for Node.js environments
 */
function createOAuthStore() {
  const statePath = getStateFilePath();

  return createStore<OAuthStoreState>()(
    persist(
      (set, get) => ({
        servers: {},
        getServerState: (serverUrl: string) => {
          return get().servers[serverUrl] || {};
        },
        setServerState: (
          serverUrl: string,
          updates: Partial<ServerOAuthState>,
        ) => {
          set((state) => ({
            servers: {
              ...state.servers,
              [serverUrl]: {
                ...state.servers[serverUrl],
                ...updates,
              },
            },
          }));
        },
        clearServerState: (serverUrl: string) => {
          set((state) => {
            const { [serverUrl]: _, ...rest } = state.servers;
            return { servers: rest };
          });
        },
      }),
      {
        name: "mcp-inspector-oauth",
        storage: createJSONStorage<OAuthStoreState>(() => ({
          getItem: async (name: string) => {
            try {
              const data = await fs.readFile(statePath, "utf-8");
              return data;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return null;
              }
              throw error;
            }
          },
          setItem: async (name: string, value: string) => {
            // Ensure directory exists
            const dir = path.dirname(statePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(statePath, value, "utf-8");
            // Set restrictive permissions (600) - only if file exists
            try {
              await fs.chmod(statePath, 0o600);
            } catch {
              // Ignore chmod errors (file may not exist in some test scenarios)
            }
          },
          removeItem: async (name: string) => {
            try {
              await fs.unlink(statePath);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
              }
            }
          },
        })),
      },
    ),
  );
}

let storeInstance: ReturnType<typeof createOAuthStore> | null = null;

/**
 * Get or create the OAuth store instance
 */
export function getOAuthStore() {
  if (!storeInstance) {
    storeInstance = createOAuthStore();
  }
  return storeInstance;
}

/**
 * Clear all OAuth client state (all servers).
 * Useful for test isolation in E2E OAuth tests.
 */
export function clearAllOAuthClientState(): void {
  const store = getOAuthStore();
  const state = store.getState();
  const urls = Object.keys(state.servers ?? {});
  for (const url of urls) {
    state.clearServerState(url);
  }
}

/**
 * Node.js storage implementation using Zustand with file-based persistence
 * For InspectorClient, CLI, and TUI
 */
export class NodeOAuthStorage implements OAuthStorage {
  private store = getOAuthStore();

  async getClientInformation(
    serverUrl: string,
    isPreregistered?: boolean,
  ): Promise<OAuthClientInformation | undefined> {
    const state = this.store.getState().getServerState(serverUrl);
    const clientInfo = isPreregistered
      ? state.preregisteredClientInformation
      : state.clientInformation;

    if (!clientInfo) {
      return undefined;
    }

    return await OAuthClientInformationSchema.parseAsync(clientInfo);
  }

  async saveClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    this.store.getState().setServerState(serverUrl, {
      clientInformation,
    });
  }

  async savePreregisteredClientInformation(
    serverUrl: string,
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    this.store.getState().setServerState(serverUrl, {
      preregisteredClientInformation: clientInformation,
    });
  }

  clearClientInformation(serverUrl: string, isPreregistered?: boolean): void {
    const state = this.store.getState().getServerState(serverUrl);
    const updates: Partial<ServerOAuthState> = {};

    if (isPreregistered) {
      updates.preregisteredClientInformation = undefined;
    } else {
      updates.clientInformation = undefined;
    }

    this.store.getState().setServerState(serverUrl, updates);
  }

  async getTokens(serverUrl: string): Promise<OAuthTokens | undefined> {
    const state = this.store.getState().getServerState(serverUrl);
    if (!state.tokens) {
      return undefined;
    }

    return await OAuthTokensSchema.parseAsync(state.tokens);
  }

  async saveTokens(serverUrl: string, tokens: OAuthTokens): Promise<void> {
    this.store.getState().setServerState(serverUrl, { tokens });
  }

  clearTokens(serverUrl: string): void {
    this.store.getState().setServerState(serverUrl, { tokens: undefined });
  }

  getCodeVerifier(serverUrl: string): string | undefined {
    const state = this.store.getState().getServerState(serverUrl);
    return state.codeVerifier;
  }

  async saveCodeVerifier(
    serverUrl: string,
    codeVerifier: string,
  ): Promise<void> {
    this.store.getState().setServerState(serverUrl, { codeVerifier });
  }

  clearCodeVerifier(serverUrl: string): void {
    this.store
      .getState()
      .setServerState(serverUrl, { codeVerifier: undefined });
  }

  getScope(serverUrl: string): string | undefined {
    const state = this.store.getState().getServerState(serverUrl);
    return state.scope;
  }

  async saveScope(serverUrl: string, scope: string | undefined): Promise<void> {
    this.store.getState().setServerState(serverUrl, { scope });
  }

  clearScope(serverUrl: string): void {
    this.store.getState().setServerState(serverUrl, { scope: undefined });
  }

  getServerMetadata(serverUrl: string): OAuthMetadata | null {
    const state = this.store.getState().getServerState(serverUrl);
    return state.serverMetadata || null;
  }

  async saveServerMetadata(
    serverUrl: string,
    metadata: OAuthMetadata,
  ): Promise<void> {
    this.store
      .getState()
      .setServerState(serverUrl, { serverMetadata: metadata });
  }

  clearServerMetadata(serverUrl: string): void {
    this.store
      .getState()
      .setServerState(serverUrl, { serverMetadata: undefined });
  }

  clear(serverUrl: string): void {
    this.store.getState().clearServerState(serverUrl);
  }
}
