import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import {
  AuthRecoveryRequiredError,
  isStandardOAuthStepUp as isCoreStandardOAuthStepUp,
  isUnauthorizedError,
  stepUpConfirmMessage,
  stepUpInsufficientScopeMessage,
  MutableRedirectUrlProvider,
} from "@inspector/core/auth/index.js";
import {
  createOAuthCallbackServer,
  runRunnerInteractiveOAuth,
} from "@inspector/core/auth/node/index.js";
import type { RunnerOAuthCallbackConfig } from "@inspector/core/auth/node/runner-oauth-callback.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { isOAuthCapableServerConfig } from "@inspector/core/client/runner.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import { createInterface } from "node:readline/promises";

/** Standard-OAuth step-up (not EMA silent re-mint). */
export function isStandardOAuthStepUp(
  challenge: AuthChallenge,
  settings?: InspectorServerSettings,
): boolean {
  return isCoreStandardOAuthStepUp(challenge, {
    enterpriseManaged: settings?.enterpriseManaged,
  });
}

async function confirmStepUpFromStdin(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question("");
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

async function promptStepUpConfirm(
  challenge: AuthChallenge,
  confirmStepUp: () => Promise<boolean>,
): Promise<boolean> {
  process.stderr.write(`${stepUpConfirmMessage(challenge)}\n`);
  process.stderr.write("Proceed with step-up authorization? [y/N] ");
  return confirmStepUp();
}

export async function runCliInteractiveOAuth(
  client: InspectorClient,
  redirectUrlProvider: MutableRedirectUrlProvider,
  callbackUrlConfig: RunnerOAuthCallbackConfig,
  options?: {
    authorizationUrl?: URL;
    authChallenge?: AuthChallenge;
  },
): Promise<void> {
  const result = await runRunnerInteractiveOAuth({
    client,
    redirectUrlProvider,
    callbackListen: callbackUrlConfig,
    createCallbackServer: createOAuthCallbackServer,
    authorizationUrl: options?.authorizationUrl,
    authChallenge: options?.authChallenge,
  });

  if (result.kind === "insufficient_scope") {
    throw new Error(stepUpInsufficientScopeMessage(result.challenge));
  }
  if (result.kind === "success") {
    process.stderr.write("Authorization complete.\n");
  }
}

export async function handleCliAuthRecoveryRequired(
  client: InspectorClient,
  error: AuthRecoveryRequiredError,
  redirectUrlProvider: MutableRedirectUrlProvider,
  callbackUrlConfig: RunnerOAuthCallbackConfig,
  serverSettings?: InspectorServerSettings,
  confirmStepUp: () => Promise<boolean> = confirmStepUpFromStdin,
): Promise<void> {
  if (isStandardOAuthStepUp(error.authChallenge, serverSettings)) {
    if (await client.checkAuthChallengeSatisfied(error.authChallenge)) {
      return;
    }
    const proceed = await promptStepUpConfirm(
      error.authChallenge,
      confirmStepUp,
    );
    if (!proceed) {
      throw new Error("Step-up authorization declined.");
    }
  } else if (await client.checkAuthChallengeSatisfied(error.authChallenge)) {
    return;
  }

  await runCliInteractiveOAuth(client, redirectUrlProvider, callbackUrlConfig, {
    authorizationUrl: error.authorizationUrl,
    ...(error.authChallenge.reason === "insufficient_scope" && {
      authChallenge: error.authChallenge,
    }),
  });
}

export async function connectInspectorWithOAuth(
  inspectorClient: InspectorClient,
  serverConfig: MCPServerConfig,
  redirectUrlProvider: MutableRedirectUrlProvider,
  callbackUrlConfig: RunnerOAuthCallbackConfig,
  serverSettings?: InspectorServerSettings,
): Promise<void> {
  try {
    await inspectorClient.connect();
  } catch (err) {
    if (!isOAuthCapableServerConfig(serverConfig)) {
      throw err;
    }

    if (err instanceof AuthRecoveryRequiredError) {
      if (
        await inspectorClient.checkAuthChallengeSatisfied(err.authChallenge)
      ) {
        await inspectorClient.connect();
        return;
      }
      await handleCliAuthRecoveryRequired(
        inspectorClient,
        err,
        redirectUrlProvider,
        callbackUrlConfig,
        serverSettings,
      );
      await inspectorClient.connect();
      return;
    }

    if (isUnauthorizedError(err)) {
      await inspectorClient.disconnect().catch(() => {});
      await runCliInteractiveOAuth(
        inspectorClient,
        redirectUrlProvider,
        callbackUrlConfig,
      );
      await inspectorClient.connect();
      return;
    }

    throw err;
  }
}

/**
 * Run `fn` once; on {@link AuthRecoveryRequiredError}, complete interactive OAuth
 * and retry `fn` a single time (no further recovery attempts).
 */
export async function withCliAuthRecoveryRetry<T>(
  inspectorClient: InspectorClient,
  redirectUrlProvider: MutableRedirectUrlProvider,
  callbackUrlConfig: RunnerOAuthCallbackConfig,
  serverSettings: InspectorServerSettings | undefined,
  fn: () => Promise<T>,
  confirmStepUp: () => Promise<boolean> = confirmStepUpFromStdin,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof AuthRecoveryRequiredError)) {
      throw err;
    }
    await handleCliAuthRecoveryRequired(
      inspectorClient,
      err,
      redirectUrlProvider,
      callbackUrlConfig,
      serverSettings,
      confirmStepUp,
    );
    process.stderr.write("Authorization complete. Retrying…\n");
    return await fn();
  }
}
