/**
 * Browser client for the backend's active-session routes (#2831):
 * `GET /api/mcp/sessions` lists every live MCP session the backend holds, and
 * `DELETE /api/mcp/sessions/:sessionId` terminates one — closing its
 * transport, which ends a stdio child. They exist because a session whose tab
 * went away otherwise holds its process until the detach grace reaps it, or
 * the Inspector exits, with no way to see it.
 *
 * This is `lib`, not `utils`: it does network I/O against the authenticated
 * `/api/*` surface. Unlike `publishAppDocument`, both calls throw on failure,
 * because the caller is an operator panel whose only useful response to a
 * failure is to say so.
 */

import type {
  RemoteSessionListResponse,
  RemoteSessionSummary,
} from "@inspector/core/mcp/remote/index.js";
import { toRecord } from "@inspector/core/json/jsonUtils.js";
import { getAuthToken } from "./authToken";

export interface ActiveSessionsApiOptions {
  /** Base URL of the backend (typically `window.location.origin`). */
  baseUrl: string;
  /** Optional auth token for the `x-mcp-remote-auth` header. */
  authToken?: string;
  /** Fetch function to use (default: `globalThis.fetch`). Useful in tests. */
  fetchFn?: typeof fetch;
}

/** This page's backend, with the token every `/api/*` call needs. */
export function browserActiveSessionsApi(): ActiveSessionsApiOptions {
  return { baseUrl: window.location.origin, authToken: getAuthToken() };
}

function request(
  path: string,
  init: RequestInit,
  opts: ActiveSessionsApiOptions,
): Promise<Response> {
  const doFetch = opts.fetchFn ?? globalThis.fetch;
  const headers: Record<string, string> = {};
  if (opts.authToken) headers["x-mcp-remote-auth"] = `Bearer ${opts.authToken}`;
  return doFetch(`${opts.baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
  });
}

/** The backend's `{ error }` message, or the bare status when it sent none. */
async function failure(res: Response, action: string): Promise<Error> {
  let detail = `HTTP ${res.status}`;
  try {
    const error = toRecord(await res.json()).error;
    if (typeof error === "string" && error) detail = error;
  } catch {
    // Not JSON — the status alone is the message.
  }
  return new Error(`${action} failed: ${detail}`);
}

export async function listActiveSessions(
  opts: ActiveSessionsApiOptions,
): Promise<RemoteSessionSummary[]> {
  const res = await request("/api/mcp/sessions", { method: "GET" }, opts);
  if (!res.ok) throw await failure(res, "Listing sessions");
  const body = (await res.json()) as Partial<RemoteSessionListResponse>;
  if (!Array.isArray(body.sessions)) {
    throw new Error("Listing sessions failed: malformed response");
  }
  return body.sessions;
}

export async function terminateActiveSession(
  sessionId: string,
  opts: ActiveSessionsApiOptions,
): Promise<void> {
  const res = await request(
    `/api/mcp/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
    opts,
  );
  if (!res.ok) throw await failure(res, "Terminating the session");
}
