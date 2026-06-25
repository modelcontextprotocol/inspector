// Types
export type {
  OAuthStep,
  AuthExecution,
  AuthProtocol,
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
  isServerOAuthConfigured,
  protocolFromOAuthConfig,
} from "./connection-state.js";
export type { BuildOAuthConnectionStateParams } from "./connection-state.js";

export { ensureCimdClientRegistration } from "./cimd.js";

// Storage
export type { OAuthStorage, IdpSessionState } from "./storage.js";
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
  generateOAuthStateWithExecution,
  generateOAuthStateWithMode,
  parseOAuthState,
  generateOAuthErrorDescription,
} from "./utils.js";

// Discovery
export { discoverScopes } from "./discovery.js";

// Logging (re-exported from core/logging)
export { silentLogger } from "../logging/index.js";
// State Machine
export type { StateMachineContext, StateTransition } from "./state-machine.js";
export { oauthTransitions, OAuthStateMachine } from "./state-machine.js";
