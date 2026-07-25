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

export { mcpAuth, type McpAuthOptions, type McpAuthResult } from "./mcpAuth.js";
export { computeScopeUnion, isStrictScopeSuperset } from "./scopes.js";

// Storage
export type {
  OAuthStorage,
  IdpSessionState,
  SaveClientInformationOptions,
} from "./storage.js";
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
  formatOAuthFailureDetail,
  isUnauthorizedError,
} from "./utils.js";

export type {
  AuthChallenge,
  AuthChallengeReason,
  AuthChallengeOutcome,
  HandleAuthChallengeOptions,
  ParseAuthChallengeContext,
  WwwAuthenticateBearerParams,
} from "./challenge.js";
export {
  AuthChallengeError,
  AuthRecoveryRequiredError,
  parseAuthChallengeFromError,
  parseAuthChallengeFromResponse,
  parseScopeString,
  parseWwwAuthenticateBearer,
  unionAuthorizationScopes,
  isAuthChallengeError,
  isConnectAuthRecoveryError,
  EMA_STEP_UP_PENDING_URL,
} from "./challenge.js";

export {
  isStandardOAuthStepUp,
  isEmaStepUp,
  isStepUpConfirmation,
  stepUpConfirmMessage,
  stepUpFollowUpMessage,
  stepUpModalTitle,
  stepUpAuthorizeActionLabel,
  emaStepUpInProgressMessage,
  emaStepUpSuccessMessage,
  emaStepUpFailureMessage,
  stepUpAdditionalScopes,
  stepUpInsufficientScopeMessage,
  oauthPreRedirectToastCopy,
  isReAuthBannerReason,
  reAuthBannerMessage,
  type OAuthInteractiveAuthKind,
} from "./oauthUx.js";

// Discovery
export { discoverScopes } from "./discovery.js";

// Logging (re-exported from core/logging)
export { silentLogger } from "../logging/index.js";
