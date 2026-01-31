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
export { BrowserOAuthStorage } from "./storage-browser.js";
export {
  NodeOAuthStorage,
  getOAuthStore,
  getStateFilePath,
  clearAllOAuthClientState,
} from "./storage-node.js";

// Providers
export type {
  OAuthProviderConfig,
  RedirectUrlProvider,
  OAuthNavigation,
  OAuthNavigationCallback,
} from "./providers.js";
export {
  MutableRedirectUrlProvider,
  BrowserNavigation,
  ConsoleNavigation,
  CallbackNavigation,
  BaseOAuthClientProvider,
  BrowserOAuthClientProvider,
} from "./providers.js";

// Utilities
export {
  parseOAuthCallbackParams,
  generateOAuthState,
  generateOAuthErrorDescription,
} from "./utils.js";

// OAuth callback server (TUI/CLI localhost redirect receiver)
export {
  createOAuthCallbackServer,
  OAuthCallbackServer,
} from "./oauth-callback-server.js";
export type {
  OAuthCallbackHandler,
  OAuthErrorHandler,
  OAuthCallbackServerStartOptions,
  OAuthCallbackServerStartResult,
} from "./oauth-callback-server.js";

// Discovery
export { discoverScopes } from "./discovery.js";

// State Machine
export type { StateMachineContext, StateTransition } from "./state-machine.js";
export { oauthTransitions, OAuthStateMachine } from "./state-machine.js";
