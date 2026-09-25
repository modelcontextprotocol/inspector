import type { AuthChallenge } from "../challenge.js";
import { findIssuerBindingFailure } from "../issuerBinding.js";
import { issuerBindingFailureCopy } from "../oauthUx.js";
import {
  createOAuthCallbackServer,
  type OAuthCallbackServer,
} from "./oauth-callback-server.js";
import type { RunnerOAuthCallbackConfig } from "./runner-oauth-callback.js";

/** Minimal InspectorClient surface for runner interactive OAuth. */
export interface RunnerInteractiveOAuthClient {
  authenticate(): Promise<URL | undefined>;
  beginInteractiveAuthorization(authorizationUrl: URL): Promise<void>;
  completeOAuthFlow(authorizationCode: string, iss?: string): Promise<void>;
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
  /**
   * Install process-wide SIGINT/SIGTERM handlers for the length of the wait
   * so Ctrl-C rejects the flow cleanly (server stopped, classifiable error)
   * instead of hanging or hitting Node's default abrupt exit. Opt-in
   * because it is process-global state: the TUI owns Ctrl-C through Ink and
   * must not have it intercepted here. CLI/mcpdo callers pass `true`.
   */
  handleSignals?: boolean;
}

/**
 * Replace an opaque SEP-2352 callback-leg failure with actionable copy (#1808).
 *
 * The runners have no banner to render, so their affordance is the message
 * itself: it explains that the recorded authorization state was lost and that
 * re-running authorization starts a fresh flow (the next `authenticate()`
 * re-runs discovery and records new state). A *genuine* issuer mismatch gets
 * the security-flavoured copy instead — never a "just try again" nudge.
 */
function toRunnerOAuthError(err: unknown): Error {
  const failure = findIssuerBindingFailure(err);
  if (failure) {
    const copy = issuerBindingFailureCopy(failure);
    return new Error(`${copy.title}. ${copy.message}`, { cause: err });
  }
  return err instanceof Error ? err : new Error(String(err));
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
  // flowDone can reject before the Promise.race below ever subscribes — a
  // signal (or an early callback error) while `server.start()` is still
  // awaited would otherwise surface as an unhandled rejection. This no-op
  // observer marks it handled for that window; the race still receives the
  // rejection through its own subscription.
  // void: intentional fire-and-forget rejection observer (see comment above)
  void flowDone.catch(() => {});

  // Ctrl-C / a caller killing the process while waiting on the loopback
  // callback would otherwise either hang until the timeout below or (for
  // SIGINT specifically, absent any handler) hit Node's default abrupt exit
  // with no cleanup. Reject cleanly instead so the server is stopped and the
  // caller gets a normal, classifiable error ("OAuth" in the message maps to
  // AUTH_REQUIRED — see clients/cli/src/error-handler.ts) rather than a raw
  // process death. Opt-in (see handleSignals) — never installed under the
  // TUI, which owns Ctrl-C through Ink.
  //
  // Every awaited phase — server.start(), authenticate() /
  // beginInteractiveAuthorization(), the callback wait, and the challenge
  // check — is raced against `signalAbort`: rejecting only flowDone would
  // leave a signal during a stalled startup or authorization ignored until
  // the final callback wait (and discarded entirely when authenticate()
  // resolves undefined).
  let signalAbortReject!: (err: Error) => void;
  const signalAbort = new Promise<never>((_, reject) => {
    signalAbortReject = reject;
  });
  // Same pre-subscription window as flowDone above.
  // void: intentional fire-and-forget rejection observer
  void signalAbort.catch(() => {});
  const onSignal = (signal: NodeJS.Signals) => {
    const err = new Error(`OAuth authorization cancelled (${signal}).`);
    signalAbortReject(err);
    flowReject(err);
  };
  const racingSignals = <T>(work: Promise<T>): Promise<T> => {
    if (!options.handleSignals) return work;
    // If the signal wins the race, `work` is abandoned while still pending;
    // observe its eventual rejection so it can't surface as unhandled.
    void work.catch(() => {});
    return Promise.race([work, signalAbort]);
  };
  if (options.handleSignals) {
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const { redirectUrl } = await racingSignals(
      server.start({
        hostname: options.callbackListen.hostname,
        port: options.callbackListen.port,
        path: options.callbackListen.pathname,
        onCallback: async (params) => {
          try {
            await options.client.completeOAuthFlow(params.code, params.iss);
            flowResolve();
          } catch (err) {
            flowReject(toRunnerOAuthError(err));
          }
        },
        onError: (params) => {
          flowReject(
            new Error(
              /* v8 ignore next -- params.error is a required non-null string, so the "OAuth error" fallback is unreachable */
              params.error_description ?? params.error ?? "OAuth error",
            ),
          );
        },
      }),
    );

    options.onCallbackServer?.(server);
    options.redirectUrlProvider.redirectUrl = redirectUrl;

    const timeoutMs =
      options.callbackTimeoutMs ?? DEFAULT_RUNNER_INTERACTIVE_OAUTH_TIMEOUT_MS;
    const waitForCallback = Promise.race([
      flowDone.finally(() => {
        /* v8 ignore next 3 -- timeoutId is assigned synchronously while the race is constructed, before flowDone can settle, so the undefined arm is unreachable */
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
    // A signal can now abort the flow between this construction and the
    // point waitForCallback is awaited (flowDone rejects but the racing
    // authenticate()/beginInteractiveAuthorization() throws first); observe
    // the rejection so that path can't surface it as unhandled.
    // void: intentional fire-and-forget rejection observer
    void waitForCallback.catch(() => {});

    if (options.authorizationUrl) {
      await racingSignals(
        options.client.beginInteractiveAuthorization(options.authorizationUrl),
      );
      await waitForCallback;
    } else {
      const authUrl = await racingSignals(options.client.authenticate());
      if (authUrl !== undefined) {
        await waitForCallback;
      } else {
        return { kind: "already_authorized" };
      }
    }

    if (options.authChallenge) {
      const satisfied = await racingSignals(
        options.client.checkAuthChallengeSatisfied(options.authChallenge),
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
    if (options.handleSignals) {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    await server.stop().catch(() => {});
  }
}
