import type { AuthChallenge } from "../challenge.js";
import {
  createOAuthCallbackServer,
  type OAuthCallbackServer,
} from "./oauth-callback-server.js";
import type { RunnerOAuthCallbackConfig } from "./runner-oauth-callback.js";

/** Minimal InspectorClient surface for runner interactive OAuth. */
export interface RunnerInteractiveOAuthClient {
  authenticate(): Promise<URL | undefined>;
  beginInteractiveAuthorization(authorizationUrl: URL): Promise<void>;
  completeOAuthFlow(authorizationCode: string): Promise<void>;
  checkAuthChallengeSatisfied(challenge: AuthChallenge): Promise<boolean>;
}

export interface RunnerInteractiveOAuthRedirectProvider {
  redirectUrl: string;
}

export type RunnerInteractiveOAuthResult =
  | { kind: "success" }
  | { kind: "already_authorized" }
  | { kind: "insufficient_scope"; challenge: AuthChallenge };

/** Default wait for loopback OAuth callback (15 minutes). */
export const DEFAULT_RUNNER_INTERACTIVE_OAUTH_TIMEOUT_MS = 15 * 60 * 1000;

export interface RunRunnerInteractiveOAuthOptions {
  client: RunnerInteractiveOAuthClient;
  redirectUrlProvider: RunnerInteractiveOAuthRedirectProvider;
  callbackListen: RunnerOAuthCallbackConfig;
  /** When set, use deferred interactive authorization (mid-session step-up / re-login). */
  authorizationUrl?: URL;
  /** When set, verify scopes after a successful token exchange (SEP-2350 step-up). */
  authChallenge?: AuthChallenge;
  createCallbackServer?: () => OAuthCallbackServer;
  /** Invoked after the listener binds; hosts may keep a ref for unmount cleanup. */
  onCallbackServer?: (server: OAuthCallbackServer) => void;
  /** Max wait for browser callback; defaults to {@link DEFAULT_RUNNER_INTERACTIVE_OAUTH_TIMEOUT_MS}. */
  callbackTimeoutMs?: number;
}

/**
 * Run interactive OAuth for Node runners (TUI / CLI): loopback callback server,
 * browser redirect, authorization-code exchange via {@link completeOAuthFlow}.
 */
export async function runRunnerInteractiveOAuth(
  options: RunRunnerInteractiveOAuthOptions,
): Promise<RunnerInteractiveOAuthResult> {
  const createServer =
    options.createCallbackServer ?? createOAuthCallbackServer;
  const server = createServer();

  let flowResolve!: () => void;
  let flowReject!: (err: Error) => void;
  const flowDone = new Promise<void>((resolve, reject) => {
    flowResolve = resolve;
    flowReject = reject;
  });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const { redirectUrl } = await server.start({
      hostname: options.callbackListen.hostname,
      port: options.callbackListen.port,
      path: options.callbackListen.pathname,
      onCallback: async (params) => {
        try {
          await options.client.completeOAuthFlow(params.code);
          flowResolve();
        } catch (err) {
          flowReject(err instanceof Error ? err : new Error(String(err)));
        }
      },
      onError: (params) => {
        flowReject(
          new Error(
            params.error_description ?? params.error ?? "OAuth error",
          ),
        );
      },
    });

    options.onCallbackServer?.(server);
    options.redirectUrlProvider.redirectUrl = redirectUrl;

    const timeoutMs =
      options.callbackTimeoutMs ?? DEFAULT_RUNNER_INTERACTIVE_OAUTH_TIMEOUT_MS;
    const waitForCallback = Promise.race([
      flowDone.finally(() => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }),
      new Promise<void>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `OAuth callback timed out after ${Math.round(timeoutMs / 1000)}s`,
            ),
          );
        }, timeoutMs);
      }),
    ]);

    if (options.authorizationUrl) {
      await options.client.beginInteractiveAuthorization(
        options.authorizationUrl,
      );
      await waitForCallback;
    } else {
      const authUrl = await options.client.authenticate();
      if (authUrl !== undefined) {
        await waitForCallback;
      } else {
        return { kind: "already_authorized" };
      }
    }

    if (options.authChallenge) {
      const satisfied = await options.client.checkAuthChallengeSatisfied(
        options.authChallenge,
      );
      if (!satisfied) {
        return {
          kind: "insufficient_scope",
          challenge: options.authChallenge,
        };
      }
    }

    return { kind: "success" };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    await server.stop().catch(() => {});
  }
}
