// Types
export type {
  OAuthStep,
  OAuthAuthType,
  MessageType,
  StatusMessage,
  AuthGuidedState,
  CallbackParams,
} from "./types.js";
export { EMPTY_GUIDED_STATE } from "./types.js";

// Storage
export type { OAuthStorage } from "./storage.js";
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
  parseOAuthCallbackParams,
  generateOAuthState,
  generateOAuthStateWithMode,
  parseOAuthState,
  generateOAuthErrorDescription,
} from "./utils.js";
export type { OAuthStateMode } from "./utils.js";

// Discovery
export { discoverScopes } from "./discovery.js";

// Logging (re-exported from core/logging)
export { silentLogger } from "../logging/index.js";
// State Machine
export type { StateMachineContext, StateTransition } from "./state-machine.js";
export { oauthTransitions, OAuthStateMachine } from "./state-machine.js";
