import {
  OAuthMetadata,
  OAuthClientInformationFull,
  OAuthClientInformation,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

// OAuth flow steps
export type OAuthStep =
  | "resource_metadata_discovery"
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
  loading: boolean;
  oauthStep: OAuthStep;
  // TODO: use sdk type
  resourceMetadata: object | null;
  oauthMetadata: OAuthMetadata | null;
  oauthClientInfo: OAuthClientInformationFull | OAuthClientInformation | null;
  authorizationUrl: string | null;
  authorizationCode: string;
  latestError: Error | null;
  statusMessage: StatusMessage | null;
  validationError: string | null;
}
