// Types
export type {
  OAuthStep,
  AuthProtocol,
  OAuthClientRegistrationKind,
  MessageType,
  StatusMessage,
  OAuthFlowState,
  OAuthConnectionState,
  CallbackParams,
} from "./types.js";
export {
  EMPTY_OAUTH_FLOW_STATE,
  authProtocolFromEnterpriseManaged,
} from "./types.js";

export {
  buildOAuthConnectionState,
  hasPersistedOAuthServerState,
  isServerOAuthConfigured,
  protocolFromOAuthConfig,
} from "./connection-state.js";
export type { BuildOAuthConnectionStateParams } from "./connection-state.js";

export { ensureCimdClientRegistration } from "./cimd.js";

// Storage
export type { OAuthStorage, IdpSessionState, SaveClientInformationOptions } from "./storage.js";
export { getServerSpecificKey, OAUTH_STORAGE_KEYS } from "./storage.js";

// Providers
export type {
  OAuthProviderConfig,
  RedirectUrlProvider,
  OAuthNavigation,
  OAuthNavigationCallback,
} from "./providers.js";
export {
  MutableRedirectUrlProvider,
  ConsoleNavigation,
  CallbackNavigation,
  BaseOAuthClientProvider,
} from "./providers.js";

// Utilities
export {
  parseHttpUrl,
  parseOAuthCallbackParams,
  generateOAuthState,
  parseOAuthState,
  generateOAuthErrorDescription,
  isUnauthorizedError,
} from "./utils.js";

// Discovery
export { discoverScopes } from "./discovery.js";

// Logging (re-exported from core/logging)
export { silentLogger } from "../logging/index.js";
