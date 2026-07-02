import type { AuthChallenge } from "./challenge.js";

export type OAuthInteractiveAuthKind = "step_up" | "reauth";

/** Origin of an interactive OAuth recovery flow (command, ambient, connect, etc.). */
export type OAuthRecoverySource =
  | "tool"
  | "prompt"
  | "resource"
  | "ambient"
  | "app";

export function isActionTriggeredOAuthRecovery(
  source: OAuthRecoverySource | undefined,
): boolean {
  return (
    source === "tool" ||
    source === "prompt" ||
    source === "resource" ||
    source === "app"
  );
}

export function oauthResumeSuccessMessage(
  authKind: OAuthInteractiveAuthKind,
  options?: { recoverySource?: OAuthRecoverySource },
): string {
  const retry = isActionTriggeredOAuthRecovery(options?.recoverySource);
  if (authKind === "step_up") {
    return retry
      ? "Step-up authorization succeeded. Retry your action."
      : "Step-up authorization succeeded.";
  }
  return retry
    ? "Authentication succeeded. Retry your action."
    : "Authentication succeeded.";
}

export function authRecoveryRestoredMessage(options?: {
  recoverySource?: OAuthRecoverySource;
}): string {
  const retry = isActionTriggeredOAuthRecovery(options?.recoverySource);
  return retry
    ? "Session credentials were updated. Retry your action."
    : "Session credentials were updated.";
}

export function oauthResumeAbandonedMessage(
  authKind: OAuthInteractiveAuthKind,
  options?: { recoverySource?: OAuthRecoverySource },
): string {
  if (authKind === "reauth") {
    return "Sign-in was not completed. Re-authenticate to restore access.";
  }
  return isActionTriggeredOAuthRecovery(options?.recoverySource)
    ? "Step-up authorization was not completed. Retry your action."
    : "Step-up authorization was not completed.";
}

/** Standard-OAuth step-up (not EMA silent re-mint). */
export function isStandardOAuthStepUp(
  challenge: AuthChallenge,
  options?: { enterpriseManaged?: boolean },
): boolean {
  return (
    challenge.reason === "insufficient_scope" && !options?.enterpriseManaged
  );
}

/** EMA step-up (`insufficient_scope` on an enterprise-managed server). */
export function isEmaStepUp(
  challenge: AuthChallenge,
  options?: { enterpriseManaged?: boolean },
): boolean {
  return (
    challenge.reason === "insufficient_scope" &&
    options?.enterpriseManaged === true
  );
}

/** Any step-up that should show the Inspector confirmation modal before proceeding. */
export function isStepUpConfirmation(
  challenge: AuthChallenge,
  options?: { enterpriseManaged?: boolean },
): boolean {
  return (
    isStandardOAuthStepUp(challenge, options) ||
    isEmaStepUp(challenge, options)
  );
}

export function stepUpConfirmMessage(
  challenge: AuthChallenge,
  options?: { enterpriseManaged?: boolean },
): string {
  const toolName = challenge.context?.toolName?.trim();
  if (toolName) {
    return options?.enterpriseManaged
      ? `Tool "${toolName}" needs additional permissions from your organization before it can continue.`
      : `Tool "${toolName}" needs additional OAuth scopes before it can continue.`;
  }
  const additional = challenge.requiredScopes?.filter(Boolean);
  if (additional?.length) {
    const label = additional.length === 1 ? "scope" : "scopes";
    return options?.enterpriseManaged
      ? `This operation needs additional organization ${label}: ${additional.join(", ")}.`
      : `This operation needs additional ${label}: ${additional.join(", ")}.`;
  }
  return options?.enterpriseManaged
    ? "This operation needs additional permissions from your organization before it can continue."
    : "This operation needs additional OAuth scopes before it can continue.";
}

/** Body copy below the step-up summary (what happens on Authorize). */
export function stepUpFollowUpMessage(options?: {
  enterpriseManaged?: boolean;
}): string {
  return options?.enterpriseManaged
    ? "Inspector will request the additional permissions from your enterprise identity provider. You may be asked to sign in if your organization session expired."
    : "You will be redirected to authorize, then returned to the inspector.";
}

/** Step-up confirm action label (e.g. TUI menu item). EMA re-mints in-process when possible. */
export function stepUpAuthorizeActionLabel(options?: {
  enterpriseManaged?: boolean;
}): string {
  return options?.enterpriseManaged
    ? "Authorize"
    : "Authorize (opens browser)";
}

export function stepUpModalTitle(options?: {
  enterpriseManaged?: boolean;
}): string {
  return options?.enterpriseManaged
    ? "Additional organization permissions required"
    : "Additional permissions required";
}

/** Toast while EMA step-up is in progress after user confirms. */
export function emaStepUpInProgressMessage(): string {
  return "Requesting additional permissions from your organization…";
}

/** Toast when EMA step-up completes successfully. */
export function emaStepUpSuccessMessage(options?: {
  recoverySource?: OAuthRecoverySource;
}): string {
  const retry = isActionTriggeredOAuthRecovery(options?.recoverySource);
  return retry
    ? "Organization permissions were updated. Retry your action."
    : "Organization permissions were updated.";
}

/** Toast when EMA step-up fails after user confirmation. */
export function emaStepUpFailureMessage(detail?: string): string {
  return detail?.trim()
    ? detail
    : "Could not obtain the additional permissions from your organization.";
}

/** Scopes the current operation still lacks (from the resource-server challenge). */
export function stepUpAdditionalScopes(challenge: AuthChallenge): string[] {
  return challenge.requiredScopes?.filter(Boolean) ?? [];
}

export function stepUpInsufficientScopeMessage(
  challenge: AuthChallenge,
): string {
  const toolName = challenge.context?.toolName?.trim();
  if (toolName) {
    return `Authorization completed, but required permissions for tool "${toolName}" were not granted. Grant the requested scopes on the authorization server, then retry.`;
  }
  const missing =
    challenge.authorizationScopes?.filter(Boolean) ??
    challenge.requiredScopes?.filter(Boolean);
  if (missing?.length) {
    return `Authorization completed, but required scopes were not granted (${missing.join(", ")}). Grant the requested permissions on the authorization server, then retry your action.`;
  }
  return "Authorization completed, but the required permissions were not granted. Grant the requested scopes on the authorization server, then retry your action.";
}

export type OAuthPreRedirectContext = "connect" | "session_recovery";

/** Pre-redirect toast copy for interactive OAuth. */
export function oauthPreRedirectToastCopy(
  authKind: OAuthInteractiveAuthKind,
  options: {
    serverName?: string;
    enterpriseManaged?: boolean;
    /** Fresh connect handshake — no existing session to recover. */
    context?: OAuthPreRedirectContext;
  },
): { title: string; message: string } | undefined {
  if (options.context === "connect") {
    return undefined;
  }
  const name = options.serverName;
  if (authKind === "step_up") {
    return {
      title: name ? `Step-up authorization for "${name}"` : "Step-up authorization",
      message: "Redirecting to authorize additional permissions…",
    };
  }
  if (options.enterpriseManaged) {
    return {
      title: name ? `Re-authenticating "${name}"` : "Re-authenticating",
      message: "Re-authenticating…",
    };
  }
  return {
    title: name ? `Session expired for "${name}"` : "Session expired",
    message: "Session expired, re-authenticating…",
  };
}

/** Challenge reasons that warrant a persistent re-auth banner (degraded session). */
export function isReAuthBannerReason(
  reason: AuthChallenge["reason"] | undefined,
): boolean {
  return (
    reason === "token_expired" ||
    reason === "unauthorized" ||
    reason === "invalid_token"
  );
}

export function reAuthBannerMessage(options: {
  serverName?: string;
  detail?: string;
}): string {
  const prefix = options.serverName
    ? `Authentication for "${options.serverName}" needs attention.`
    : "Authentication needs attention.";
  return options.detail ? `${prefix} ${options.detail}` : prefix;
}
