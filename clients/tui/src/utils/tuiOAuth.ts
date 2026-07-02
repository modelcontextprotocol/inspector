import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import {
  isStandardOAuthStepUp as isCoreStandardOAuthStepUp,
  isStepUpConfirmation as isCoreStepUpConfirmation,
  stepUpConfirmMessage,
  stepUpInsufficientScopeMessage,
} from "@inspector/core/auth/oauthUx.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";

export { stepUpConfirmMessage, stepUpInsufficientScopeMessage };

export {
  stepUpAuthorizeActionLabel,
  stepUpFollowUpMessage,
  stepUpModalTitle,
} from "@inspector/core/auth/oauthUx.js";

/** Standard-OAuth step-up (not EMA silent re-mint). */
export function isStandardOAuthStepUp(
  challenge: AuthChallenge,
  settings?: InspectorServerSettings,
): boolean {
  return isCoreStandardOAuthStepUp(challenge, {
    enterpriseManaged: settings?.enterpriseManaged,
  });
}

/** Standard or EMA step-up that requires in-app confirmation before OAuth. */
export function isStepUpConfirmation(
  challenge: AuthChallenge,
  settings?: InspectorServerSettings,
): boolean {
  return isCoreStepUpConfirmation(challenge, {
    enterpriseManaged: settings?.enterpriseManaged,
  });
}
