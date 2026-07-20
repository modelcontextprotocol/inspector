import { parseOAuthPersistBlob } from "@inspector/core/auth/oauth-persist.js";
import {
  clearAllOAuthClientState,
  getStateFilePath,
  NodeOAuthStorage,
  resetNodeOAuthStorageCache,
} from "@inspector/core/auth/node/storage-node.js";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";

/** Same canonicalisation as one-shot `normalizeServerUrl` (avoid importing cli.ts). */
function normalizeServerUrl(serverUrl: string): string {
  try {
    return new URL(serverUrl).href;
  } catch {
    return serverUrl;
  }
}

export type StoredAuthEntry = {
  url: string;
  hasTokens: boolean;
  hasRefreshToken: boolean;
};

export type StoredAuthList = {
  oauthStatePath: string;
  servers: StoredAuthEntry[];
};

type TokenBlob = {
  access_token?: string;
  refresh_token?: string;
};

function tokenFlagsFromState(state: unknown): {
  hasTokens: boolean;
  hasRefreshToken: boolean;
} {
  if (state == null || typeof state !== "object") {
    return { hasTokens: false, hasRefreshToken: false };
  }
  const s = state as {
    tokens?: TokenBlob;
    byIssuer?: Record<string, { tokens?: TokenBlob }>;
  };
  if (s.tokens?.access_token) {
    return {
      hasTokens: true,
      hasRefreshToken: Boolean(s.tokens.refresh_token),
    };
  }
  for (const slot of Object.values(s.byIssuer ?? {})) {
    if (slot?.tokens?.access_token) {
      return {
        hasTokens: true,
        hasRefreshToken: Boolean(slot.tokens.refresh_token),
      };
    }
  }
  return { hasTokens: false, hasRefreshToken: false };
}

async function readServersMap(
  statePath: string,
): Promise<Record<string, unknown>> {
  const { readFile } = await import("node:fs/promises");
  try {
    const text = await readFile(statePath, "utf8");
    const snapshot = parseOAuthPersistBlob(text);
    if (snapshot?.servers && typeof snapshot.servers === "object") {
      return snapshot.servers as Record<string, unknown>;
    }
  } catch {
    // absent / unreadable
  }
  return {};
}

/** List every server key in the shared OAuth store (tokens optional). */
export async function listStoredAuth(): Promise<StoredAuthList> {
  const oauthStatePath = getStateFilePath();
  const servers = await readServersMap(oauthStatePath);
  const entries = Object.keys(servers)
    .sort((a, b) => a.localeCompare(b))
    .map((url) => ({
      url,
      ...tokenFlagsFromState(servers[url]),
    }));
  return { oauthStatePath, servers: entries };
}

/**
 * Resolve a user-supplied key to a stored server URL (exact, then normalised).
 */
export async function resolveStoredAuthKey(key: string): Promise<string> {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new CliExitCodeError(
      EXIT_CODES.USAGE,
      "auth/clear requires a server URL key (from auth/list) or --all",
      { code: "usage" },
    );
  }
  const { servers } = await listStoredAuth();
  const urls = servers.map((s) => s.url);
  if (urls.includes(trimmed)) return trimmed;
  const normalized = normalizeServerUrl(trimmed);
  if (urls.includes(normalized)) return normalized;
  // Allow clearing a key that is not listed (no-op clear) when it normalises
  // to a URL — still useful after partial writes.
  if (normalized !== trimmed || /^https?:\/\//i.test(trimmed)) {
    return normalized;
  }
  throw new CliExitCodeError(
    EXIT_CODES.USAGE,
    `No stored auth entry for '${trimmed}'. Use auth/list to see keys.`,
    { code: "usage" },
  );
}

/** Clear one server's OAuth state from the shared store. */
export async function clearStoredAuth(key: string): Promise<{ url: string }> {
  const url = await resolveStoredAuthKey(key);
  const storage = new NodeOAuthStorage();
  await storage.clear(url);
  resetNodeOAuthStorageCache();
  return { url };
}

/** Clear every server entry in the shared OAuth store. */
export async function clearAllStoredAuth(): Promise<{ cleared: number }> {
  const before = await listStoredAuth();
  await clearAllOAuthClientState();
  resetNodeOAuthStorageCache();
  return { cleared: before.servers.length };
}

/**
 * Drop stored OAuth state for an HTTP(S) server URL so the next connect cannot
 * silently reuse tokens (`--relogin`). No-op when `serverUrl` is missing.
 */
export async function clearStoredAuthForRelogin(
  serverUrl: string | undefined,
): Promise<void> {
  if (!serverUrl?.trim()) return;
  const url = normalizeServerUrl(serverUrl.trim());
  const storage = new NodeOAuthStorage();
  await storage.clear(url);
  resetNodeOAuthStorageCache();
}
