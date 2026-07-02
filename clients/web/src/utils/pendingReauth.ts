import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import type { OAuthRecoverySource } from "@inspector/core/auth/oauthUx.js";
import type { OAuthResumeAuthKind } from "./oauthResume.js";

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
