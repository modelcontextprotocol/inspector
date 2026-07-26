import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import type { OAuthRecoverySource } from "@inspector/core/auth/oauthUx.js";

/**
 * Which interactive auth flow a resume/recovery represents. Declared here in the
 * pure `utils/` layer (rather than in `lib/oauthResume`) so the only arrow
 * between the two directories points `lib → utils`; `lib/oauthResume`
 * re-exports it for its existing consumers.
 */
export type OAuthResumeAuthKind = "step_up" | "reauth";

/** Origin of a deferred or resumed auth recovery flow (matches web `StepUpSource`). */
export type PendingReauthSource = OAuthRecoverySource;

/** Deferred ambient interactive recovery for a background browser tab. */
export interface PendingReauth {
  serverId: string;
  challenge: AuthChallenge;
  authorizationUrl: URL;
  authKind: OAuthResumeAuthKind;
  source: PendingReauthSource;
}

/**
 * In-memory only — survives tab visibility changes but not a full page reload.
 * OAuth resume snapshot is written only once interactive redirect starts.
 */
