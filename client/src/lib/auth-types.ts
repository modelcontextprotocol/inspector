import {
  OAuthMetadata,
  OAuthClientInformationFull,
  OAuthClientInformation,
  OAuthTokens,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

// OAuth flow steps
export type OAuthStep =
  | "metadata_discovery"
  | "client_registration"
  | "authorization_redirect"
  | "authorization_code"
  | "token_request"
  | "complete";

// Message types for inline feedback
export type MessageType = "success" | "error" | "info";

export interface StatusMessage {
  type: MessageType;
  message: string;
}

// Single state interface for OAuth state
export interface AuthDebuggerState {
  isInitiatingAuth: boolean;
  oauthTokens: OAuthTokens | null;
  oauthStep: OAuthStep;
  resourceMetadata: OAuthProtectedResourceMetadata | null;
  resourceMetadataError: Error | null;
  resource: URL | null;
  authServerUrl: URL | null;
  oauthMetadata: OAuthMetadata | null;
  oauthClientInfo: OAuthClientInformationFull | OAuthClientInformation | null;
  authorizationUrl: URL | null;
  authorizationCode: string;
  latestError: Error | null;
  statusMessage: StatusMessage | null;
  validationError: string | null;
}

export const EMPTY_DEBUGGER_STATE: AuthDebuggerState = {
  isInitiatingAuth: false,
  oauthTokens: null,
  oauthStep: "metadata_discovery",
  oauthMetadata: null,
  resourceMetadata: null,
  resourceMetadataError: null,
  resource: null,
  authServerUrl: null,
  oauthClientInfo: null,
  authorizationUrl: null,
  authorizationCode: "",
  latestError: null,
  statusMessage: null,
  validationError: null,
};
