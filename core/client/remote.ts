/**
 * Remote HTTP load/save for client.json via /api/storage/client.
 */

import {
  parseClientConfig,
  serializeClientConfig,
} from "./config-parse.js";
import type { ClientConfig } from "./types.js";

export interface RemoteClientConfigOptions {
  /** Base URL of the remote server (e.g. http://localhost:3000) */
  baseUrl: string;
  /** Optional auth token for x-mcp-remote-auth header */
  authToken?: string;
  fetchFn?: typeof fetch;
}

/**
 * GET /api/storage/client — returns `{}` when store is empty or 404.
 */
export async function loadClientConfigRemote(
  options: RemoteClientConfigOptions,
): Promise<ClientConfig> {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const headers: Record<string, string> = {};
  if (options.authToken) {
    headers["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
  }

  const res = await fetchFn(`${baseUrl}/api/storage/client`, {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    if (res.status === 404) {
      return {};
    }
    throw new Error(`Failed to read client config: ${res.status}`);
  }

  const store = await res.json();
  if (!store || typeof store !== "object" || Object.keys(store).length === 0) {
    return {};
  }

  return parseClientConfig(store);
}

/**
 * POST /api/storage/client — replaces the stored client config blob.
 */
export async function saveClientConfigRemote(
  config: ClientConfig,
  options: RemoteClientConfigOptions,
): Promise<void> {
  const validated = parseClientConfig(config);
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.authToken) {
    headers["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
  }

  const res = await fetchFn(`${baseUrl}/api/storage/client`, {
    method: "POST",
    headers,
    body: serializeClientConfig(validated),
  });

  if (!res.ok) {
    throw new Error(`Failed to write client config: ${res.status}`);
  }
}
