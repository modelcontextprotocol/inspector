/**
 * Non-TTY park path for `auth/ema-login`, mirroring the connect-time OAuth
 * park in auth-helper.ts: instead of blocking for up to 15 minutes on the
 * loopback callback (printing the IdP URL to a stderr no agent relays), the
 * parent spawns a detached helper that owns the callback wait, reads the IdP
 * authorization URL off its stdout, and exits 0 with that URL in the result
 * payload so the agent can relay it and poll `auth/ema-status`.
 *
 * This lives in its own module (not ema.ts, not auth-helper.ts) because it
 * imports from both and neither imports it — keeping the dependency graph
 * acyclic.
 */
import {
  clearEmaIdpSession,
  getEmaIdpLoginState,
  normalizeIdpIssuer,
} from "@inspector/core/auth/ema/index.js";
import { CallbackNavigation } from "@inspector/core/auth/index.js";
import { NodeOAuthStorage } from "@inspector/core/auth/node/index.js";
import {
  obtainPendingUrlForKey,
  pendingAuthMarkerPath,
  removeOwnPendingAuthMarker,
  writePendingAuthMarker,
  PENDING_AUTH_TTL_MS,
  type AuthHelperEvent,
} from "./auth-helper.js";
import {
  loadEmaIdpConfig,
  requireIdp,
  runEmaIdpInteractiveFlow,
  type EmaLoginResult,
} from "./ema.js";

/** Hidden subcommand the detached EMA login helper runs as. */
export const EMA_LOGIN_HELPER_COMMAND = "auth/complete-ema-login";

/**
 * Marker key for the pending-login marker: per IdP issuer, not per server —
 * leg 1 is server-less, and every EMA server behind the same issuer shares
 * the one IdP session a login establishes.
 */
export function emaLoginMarkerKey(issuer: string): string {
  return `ema-idp:${issuer}`;
}

export type PendingEmaLoginResult = EmaLoginResult & {
  /** Present (true) when the login was parked on a detached helper. */
  pendingLogin?: true;
  /** IdP authorization URL for the agent to relay to the human. */
  authUrl?: string;
};

/**
 * Non-TTY `auth/ema-login`: short-circuit if already logged in (or clear the
 * session on --relogin), then park the interactive IdP flow on a detached
 * helper and return its authorization URL. The helper survives this process
 * and completes the code exchange when the user finishes signing in; callers
 * poll `auth/ema-status` for `loginState: "logged_in"`.
 */
export async function startPendingEmaLogin(options?: {
  relogin?: boolean;
  helperArgv1?: string;
  waitMs?: number;
  pollMs?: number;
}): Promise<PendingEmaLoginResult> {
  const { idp, enabled } = await loadEmaIdpConfig();
  const active = requireIdp(idp, enabled);
  const issuer = normalizeIdpIssuer(active.issuer);
  const storage = new NodeOAuthStorage();

  if (options?.relogin) {
    await clearEmaIdpSession(storage, active.issuer);
  } else if (
    (await getEmaIdpLoginState(storage, active.issuer)) === "logged_in"
  ) {
    return { issuer, loginState: "logged_in", alreadyLoggedIn: true };
  }

  const authUrl = await obtainPendingUrlForKey(
    emaLoginMarkerKey(issuer),
    EMA_LOGIN_HELPER_COMMAND,
    // The helper re-reads config itself; params document is empty.
    {},
    options,
  );

  return {
    issuer,
    loginState: await getEmaIdpLoginState(storage, active.issuer),
    alreadyLoggedIn: false,
    pendingLogin: true,
    authUrl,
  };
}

/**
 * Entry point for the hidden helper subcommand. Runs the full IdP OIDC flow
 * with a navigation that publishes the authorization URL as a pending-login
 * marker plus an NDJSON event on stdout (instead of a prompt line), and
 * never opens a browser — the human the URL is relayed to does that.
 */
export async function runEmaLoginHelper(): Promise<void> {
  // The parent unrefs and exits once it has the URL; every later stdout
  // write would EPIPE without this guard.
  const emit = (event: AuthHelperEvent) => {
    try {
      process.stdout.write(`${JSON.stringify(event)}\n`);
    } catch {
      // Parent is gone; the flow itself is unaffected.
    }
  };
  process.stdout.on("error", () => {});

  let markerPath: string | undefined;
  try {
    const { idp, enabled } = await loadEmaIdpConfig();
    const active = requireIdp(idp, enabled);
    const issuer = normalizeIdpIssuer(active.issuer);
    const storage = new NodeOAuthStorage();
    await runEmaIdpInteractiveFlow(
      active,
      storage,
      new CallbackNavigation(async (url) => {
        // No arming guard needed: unlike connect-time OAuth there is no
        // SDK-internal auth() phase — this flow owns its one authorize URL.
        markerPath = pendingAuthMarkerPath(emaLoginMarkerKey(issuer));
        writePendingAuthMarker(markerPath, {
          url: url.href,
          pid: process.pid,
          expiresAt: Date.now() + PENDING_AUTH_TTL_MS,
        });
        emit({ event: "auth_url", url: url.href });
      }),
    );
    emit({ event: "done" });
  } catch (error) {
    emit({
      event: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    if (markerPath !== undefined) removeOwnPendingAuthMarker(markerPath);
  }
}
