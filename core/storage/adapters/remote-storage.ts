/**
 * Remote HTTP storage adapter for Zustand persist middleware.
 * Stores entire store state via HTTP API (GET/POST/DELETE /api/storage/:storeId).
 */

import { createJSONStorage } from "zustand/middleware";

export interface RemoteStorageAdapterOptions {
  /** Base URL of the remote server (e.g. http://localhost:3000) */
  baseUrl: string;
  /** Store ID (e.g. "oauth", "inspector-settings") */
  storeId: string;
  /** Optional auth token for x-mcp-remote-auth header */
  authToken?: string;
  /** Fetch function to use (default: globalThis.fetch) */
  fetchFn?: typeof fetch;
}

/**
 * Creates a Zustand storage adapter that reads/writes via HTTP API.
 * Conforms to Zustand's StateStorage interface.
 */
export function createRemoteStorageAdapter(
  options: RemoteStorageAdapterOptions,
): ReturnType<typeof createJSONStorage> {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  return createJSONStorage(() => ({
    getItem: async (_name: string) => {
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
      // Zustand stores: { state: {...}, version: number }
      // API returns the stored blob. If empty, Zustand hasn't initialized yet.
      if (Object.keys(store).length === 0) {
        return null; // Empty store means not initialized yet
      }
      // Return the stored Zustand format as string
      return JSON.stringify(store);
    },
    setItem: async (_name: string, value: string) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (options.authToken) {
        headers["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
      }

      const url = `${baseUrl}/api/storage/${options.storeId}`;
      try {
        // Zustand gives us the full persisted format as a string
        // Store it as-is (the API treats it as an opaque blob).
        // `keepalive` lets this POST outlive an immediately-following
        // full-page navigation (the OAuth authorize redirect): without it the
        // browser may abort the request mid-flight and the just-saved
        // codeVerifier/clientInformation never reaches disk.
        const res = await fetchFn(url, {
          method: "POST",
          headers,
          body: value, // Already a JSON string from Zustand
          keepalive: true,
        });

        if (!res.ok) {
          throw new Error(
            `Failed to write store '${options.storeId}' to ${url}: ${res.status}`,
          );
        }
      } catch (err) {
        // Zustand's persist middleware swallows setItem rejections — without
        // this the user sees a green "Connected" while the token never landed
        // on disk. Surface the failure so it's at least observable.
        console.error("[remote-storage] persist write failed:", err);
        throw err;
      }
    },
    removeItem: async (_name: string) => {
      const headers: Record<string, string> = {};
      if (options.authToken) {
        headers["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
      }

      const res = await fetchFn(`${baseUrl}/api/storage/${options.storeId}`, {
        method: "DELETE",
        headers,
      });

      // 404 is fine (already deleted), but other errors should propagate
      if (!res.ok && res.status !== 404) {
        throw new Error(`Failed to delete store: ${res.status}`);
      }
    },
  }));
}
