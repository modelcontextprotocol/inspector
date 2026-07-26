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
import type { RunnerInteractiveOAuthClient } from "@inspector/core/auth/node/runner-interactive-oauth.js";
import type { RunnerOAuthCallbackConfig } from "@inspector/core/auth/node/runner-oauth-callback.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { isOAuthCapableServerConfig } from "@inspector/core/client/runner.js";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import { createInterface } from "node:readline/promises";
import { CliExitCodeError, EXIT_CODES } from "./error-handler.js";
import type { CliOAuthAutoOpenControl } from "./cli-oauth-navigation.js";

/** Client surface needed for connect + mid-RPC OAuth recovery. */
export type CliOAuthClient = RunnerInteractiveOAuthClient & {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
};

export type CliOAuthConnectOptions = {
  /**
   * When true, never open interactive OAuth / step-up prompts. Use the shared
   * store if it can satisfy the challenge; otherwise fail with AUTH_REQUIRED.
   */
  storedAuthOnly?: boolean;
  /**
   * Arms browser auto-open only around the CLI-owned interactive OAuth flow
   * (callback server listening). See {@link createCliOAuthNavigation}.
   */
  autoOpenControl?: CliOAuthAutoOpenControl;
};

function storedAuthOnlyFailure(message: string): never {
  throw new CliExitCodeError(EXIT_CODES.AUTH_REQUIRED, message, {
    code: "auth_required",
  });
}

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

async function withArmedAutoOpen<T>(
  control: CliOAuthAutoOpenControl | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!control) return fn();
  control.armed = true;
  try {
    return await fn();
  } finally {
    control.armed = false;
  }
}

export async function runCliInteractiveOAuth(
  client: RunnerInteractiveOAuthClient,
  redirectUrlProvider: MutableRedirectUrlProvider,
  callbackUrlConfig: RunnerOAuthCallbackConfig,
  options?: {
    authorizationUrl?: URL;
    authChallenge?: AuthChallenge;
    autoOpenControl?: CliOAuthAutoOpenControl;
  },
): Promise<void> {
  const result = await withArmedAutoOpen(options?.autoOpenControl, () =>
    runRunnerInteractiveOAuth({
      client,
      redirectUrlProvider,
      callbackListen: callbackUrlConfig,
      createCallbackServer: createOAuthCallbackServer,
      authorizationUrl: options?.authorizationUrl,
      authChallenge: options?.authChallenge,
    }),
  );

  if (result.kind === "insufficient_scope") {
    throw new Error(stepUpInsufficientScopeMessage(result.challenge));
  }
  if (result.kind === "success") {
    process.stderr.write("Authorization complete.\n");
  }
}

export async function handleCliAuthRecoveryRequired(
  client: RunnerInteractiveOAuthClient,
  error: AuthRecoveryRequiredError,
  redirectUrlProvider: MutableRedirectUrlProvider,
  callbackUrlConfig: RunnerOAuthCallbackConfig,
  serverSettings?: InspectorServerSettings,
  confirmStepUp: () => Promise<boolean> = confirmStepUpFromStdin,
  autoOpenControl?: CliOAuthAutoOpenControl,
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
    autoOpenControl,
    ...(error.authChallenge.reason === "insufficient_scope" && {
      authChallenge: error.authChallenge,
    }),
  });
}

export async function connectInspectorWithOAuth(
  inspectorClient: CliOAuthClient,
  serverConfig: MCPServerConfig,
  redirectUrlProvider: MutableRedirectUrlProvider,
  callbackUrlConfig: RunnerOAuthCallbackConfig,
  serverSettings?: InspectorServerSettings,
  options?: CliOAuthConnectOptions,
): Promise<void> {
  try {
    await inspectorClient.connect();
  } catch (err) {
    if (!isOAuthCapableServerConfig(serverConfig)) {
      throw err;
    }

    if (err instanceof AuthRecoveryRequiredError) {
      // Under --stored-auth-only, give the store one chance then bail — avoid
      // calling handle (which would re-check) on the failure path.
      if (options?.storedAuthOnly) {
        if (
          await inspectorClient.checkAuthChallengeSatisfied(err.authChallenge)
        ) {
          await inspectorClient.connect();
          return;
        }
        storedAuthOnlyFailure(
          err.message ||
            "Authentication required and --stored-auth-only is set; refusing interactive OAuth.",
        );
      }
      await handleCliAuthRecoveryRequired(
        inspectorClient,
        err,
        redirectUrlProvider,
        callbackUrlConfig,
        serverSettings,
        confirmStepUpFromStdin,
        options?.autoOpenControl,
      );
      await inspectorClient.connect();
      return;
    }

    if (isUnauthorizedError(err)) {
      if (options?.storedAuthOnly) {
        storedAuthOnlyFailure(
          err instanceof Error
            ? err.message
            : "Authentication required and --stored-auth-only is set; refusing interactive OAuth.",
        );
      }
      await inspectorClient.disconnect().catch(() => {});
      await runCliInteractiveOAuth(
        inspectorClient,
        redirectUrlProvider,
        callbackUrlConfig,
        { autoOpenControl: options?.autoOpenControl },
      );
      await inspectorClient.connect();
      return;
    }

    throw err;
  }
}

/**
 * Run `fn` once; on auth recovery errors, complete interactive OAuth and retry
 * `fn` a single time (no further recovery attempts). Mirrors
 * {@link connectInspectorWithOAuth}: handles both
 * {@link AuthRecoveryRequiredError} and plain unauthorized errors.
 */
export async function withCliAuthRecoveryRetry<T>(
  inspectorClient: CliOAuthClient,
  redirectUrlProvider: MutableRedirectUrlProvider,
  callbackUrlConfig: RunnerOAuthCallbackConfig,
  serverSettings: InspectorServerSettings | undefined,
  fn: () => Promise<T>,
  confirmStepUp: () => Promise<boolean> = confirmStepUpFromStdin,
  options?: CliOAuthConnectOptions,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthRecoveryRequiredError) {
      // Satisfied-check lives in handleCliAuthRecoveryRequired for the
      // interactive path; under --stored-auth-only check once here then bail.
      if (options?.storedAuthOnly) {
        if (
          await inspectorClient.checkAuthChallengeSatisfied(err.authChallenge)
        ) {
          return await fn();
        }
        storedAuthOnlyFailure(
          err.message ||
            "Authentication required and --stored-auth-only is set; refusing interactive OAuth.",
        );
      }
      await handleCliAuthRecoveryRequired(
        inspectorClient,
        err,
        redirectUrlProvider,
        callbackUrlConfig,
        serverSettings,
        confirmStepUp,
        options?.autoOpenControl,
      );
      process.stderr.write("Authorization complete. Retrying…\n");
      return await fn();
    }

    if (isUnauthorizedError(err)) {
      if (options?.storedAuthOnly) {
        storedAuthOnlyFailure(
          err instanceof Error
            ? err.message
            : "Authentication required and --stored-auth-only is set; refusing interactive OAuth.",
        );
      }
      await inspectorClient.disconnect().catch(() => {});
      await runCliInteractiveOAuth(
        inspectorClient,
        redirectUrlProvider,
        callbackUrlConfig,
        { autoOpenControl: options?.autoOpenControl },
      );
      process.stderr.write("Authorization complete. Retrying…\n");
      return await fn();
    }

    throw err;
  }
}
