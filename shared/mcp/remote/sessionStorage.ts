/**
 * Remote HTTP storage implementation for InspectorClient session state.
 * Uses the remote /api/storage/:storeId endpoint to persist session data
 * across page navigations during OAuth flows.
 */

import type {
  InspectorClientStorage,
  InspectorClientSessionState,
} from "../sessionStorage.js";

export interface RemoteInspectorClientStorageOptions {
  /** Base URL of the remote server (e.g. http://localhost:3000) */
  baseUrl: string;
  /** Optional auth token for x-mcp-remote-auth header */
  authToken?: string;
  /** Fetch function to use (default: globalThis.fetch) */
  fetchFn?: typeof fetch;
}

/**
 * Remote HTTP storage implementation for InspectorClient session state.
 * Stores session data via HTTP API (GET/POST/DELETE /api/storage/:storeId).
 * For web clients that need to persist session state across OAuth redirects.
 */
export class RemoteInspectorClientStorage implements InspectorClientStorage {
  private baseUrl: string;
  private authToken?: string;
  private fetchFn: typeof fetch;

  constructor(options: RemoteInspectorClientStorageOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.authToken = options.authToken;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  private getStoreId(sessionId: string): string {
    // Use a prefix to distinguish from OAuth storage
    return `inspector-session-${sessionId}`;
  }

  async saveSession(
    sessionId: string,
    state: InspectorClientSessionState,
  ): Promise<void> {
    const storeId = this.getStoreId(sessionId);
    const url = `${this.baseUrl}/api/storage/${encodeURIComponent(storeId)}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.authToken) {
      headers["x-mcp-remote-auth"] = `Bearer ${this.authToken}`;
    }

    // Serialize state (convert Date objects to ISO strings for JSON)
    const serializedState = {
      ...state,
      fetchRequests: state.fetchRequests.map((req) => ({
        ...req,
        timestamp:
          req.timestamp instanceof Date
            ? req.timestamp.toISOString()
            : req.timestamp,
      })),
    };

    const res = await this.fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(serializedState),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to save session: ${res.status} ${text}`);
    }
  }

  async loadSession(
    sessionId: string,
  ): Promise<InspectorClientSessionState | undefined> {
    const storeId = this.getStoreId(sessionId);
    const url = `${this.baseUrl}/api/storage/${encodeURIComponent(storeId)}`;

    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers["x-mcp-remote-auth"] = `Bearer ${this.authToken}`;
    }

    const res = await this.fetchFn(url, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      if (res.status === 404) {
        return undefined;
      }
      const text = await res.text();
      throw new Error(`Failed to load session: ${res.status} ${text}`);
    }

    const data = (await res.json()) as InspectorClientSessionState;

    // Deserialize state (convert ISO strings back to Date objects)
    return {
      ...data,
      fetchRequests: data.fetchRequests.map((req) => ({
        ...req,
        timestamp:
          typeof req.timestamp === "string"
            ? new Date(req.timestamp)
            : req.timestamp instanceof Date
              ? req.timestamp
              : new Date(req.timestamp),
      })),
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    const storeId = this.getStoreId(sessionId);
    const url = `${this.baseUrl}/api/storage/${encodeURIComponent(storeId)}`;

    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers["x-mcp-remote-auth"] = `Bearer ${this.authToken}`;
    }

    const res = await this.fetchFn(url, {
      method: "DELETE",
      headers,
    });

    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`Failed to delete session: ${res.status} ${text}`);
    }
  }
}
