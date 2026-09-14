import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import {
  isEmaStepUp as isCoreEmaStepUp,
  isStepUpConfirmation as isCoreStepUpConfirmation,
} from "@inspector/core/auth/oauthUx.js";
import type { ServerEntry } from "@inspector/core/mcp/types.js";

// Thin adapters over core's step-up predicates: the web client holds a
// `ServerEntry` where core takes only the enterprise-managed settings, so these
// project one onto the other at the single place App.tsx asks the question.

export function isEmaStepUp(
  challenge: AuthChallenge,
  server: ServerEntry | undefined,
): boolean {
  return isCoreEmaStepUp(challenge, {
    enterpriseManaged: server?.settings?.enterpriseManaged,
  });
}

export function isStepUpConfirmation(
  challenge: AuthChallenge,
  server: ServerEntry | undefined,
): boolean {
  return isCoreStepUpConfirmation(challenge, {
    enterpriseManaged: server?.settings?.enterpriseManaged,
  });
}

/** Which in-flight action opened the step-up modal (for scoped cancel UX). */
export type StepUpSource = "tool" | "prompt" | "resource" | "ambient" | "app";

/**
 * The in-flight step-up prompt App.tsx holds while the user completes (or
 * cancels) an interactive step-up authorization. Named here beside
 * `StepUpSource` rather than inline in App.tsx so `useSessionRef`'s snapshot
 * can name it without importing from the component that owns the state.
 */
export interface PendingStepUp {
  challenge: AuthChallenge;
  authorizationUrl: URL;
  serverId: string;
  source: StepUpSource;
  enterpriseManaged?: boolean;
}
