/**
 * Types for the remote transport protocol.
 */

import type {
  MCPServerConfig,
  FetchRequestEntryBase,
  InspectorServerSettings,
} from "../types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import type { AuthChallenge } from "../../auth/challenge.js";
import type { OAuthTokens } from "@modelcontextprotocol/client";

/** OAuth token set pushed to the remote backend for upstream MCP Bearer auth. */
export interface RemoteMcpOAuthTokens {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

/**
 * Auth credentials for the upstream MCP transport on the remote backend.
 * Extensible so server-side token refresh can be added without a new API shape.
 */
export interface RemoteAuthState {
  /** Bearer tokens for HTTP MCP transports (streamable-http / SSE). */
  oauthTokens?: RemoteMcpOAuthTokens;
  /**
   * OAuth client credentials for server-side refresh at the token endpoint.
   * Optional today while the browser owns interactive OAuth and refresh.
   */
  oauthClient?: {
    client_id: string;
    client_secret?: string;
  };
}

export function oauthTokensToRemoteAuthState(
  tokens: OAuthTokens | RemoteMcpOAuthTokens,
): RemoteAuthState {
  return {
    oauthTokens: {
      access_token: tokens.access_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      id_token: tokens.id_token,
    },
  };
}

export interface RemoteConnectRequest {
  /** MCP server config (stdio, sse, or streamable-http) */
  config: MCPServerConfig;
  /**
   * Optional per-server runtime settings (headers, etc.). When supplied the
   * backend sources transport-level headers from settings.headers rather than
   * from the legacy `config.headers` field (which has been removed).
   */
  settings?: InspectorServerSettings;
  /**
   * Initial auth for upstream MCP HTTP transports.
   * Prefer {@link authState}; {@link oauthTokens} is accepted for compatibility.
   */
  authState?: RemoteAuthState;
  /** @deprecated Prefer {@link authState}. */
  oauthTokens?: RemoteMcpOAuthTokens;
}

export interface RemoteSetAuthStateRequest {
  sessionId: string;
  authState: RemoteAuthState;
}

export interface RemoteSetAuthStateResponse {
  ok: true;
}

export interface RemoteConnectResponseSuccess {
  ok: true;
  sessionId: string;
}

export interface RemoteConnectResponseAuthChallenge {
  ok: false;
  kind: "auth_challenge";
  authChallenge: AuthChallenge;
}

export interface RemoteConnectResponseTransportError {
  ok: false;
  kind: "transport_error";
  error: string;
}

export type RemoteConnectResponse =
  | RemoteConnectResponseSuccess
  | RemoteConnectResponseAuthChallenge
  | RemoteConnectResponseTransportError
  | { sessionId: string };

export type RemoteSendResponse =
  | { ok: true }
  | {
      ok: false;
      kind: "auth_challenge";
      authChallenge: AuthChallenge;
    }
  | {
      ok: false;
      kind: "transport_error";
      error: string;
    };

export interface RemoteSendRequest {
  message: JSONRPCMessage;
  /** Optional, for associating response with request (e.g. streamable-http) */
  relatedRequestId?: string | number;
}

export type RemoteEventType =
  | "message"
  | "fetch_request"
  | "fetch_request_body_update"
  | "stdio_log"
  | "transport_error"
  | "auth_challenge";

export interface RemoteEventMessage {
  type: "message";
  data: unknown;
}

export interface RemoteEventFetchRequest {
  type: "fetch_request";
  data: FetchRequestEntryBase;
}

export interface RemoteEventFetchRequestBodyUpdate {
  type: "fetch_request_body_update";
  data: { id: string; responseBody: string };
}

export interface RemoteEventStdioLog {
  type: "stdio_log";
  data: { timestamp: string; message: string };
}

export interface RemoteEventTransportError {
  type: "transport_error";
  data: {
    error: string;
    code?: string | number;
  };
}

export interface RemoteEventAuthChallenge {
  type: "auth_challenge";
  data: AuthChallenge;
}

export type RemoteEvent =
  | RemoteEventMessage
  | RemoteEventFetchRequest
  | RemoteEventFetchRequestBodyUpdate
  | RemoteEventStdioLog
  | RemoteEventTransportError
  | RemoteEventAuthChallenge;
