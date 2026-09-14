/**
 * Default OAuth callback URL for Node runners (TUI / CLI).
 *
 * Web uses the main Hono server (`localhost:6274` by default). Runners spin up
 * a minimal loopback listener; default port 6276 (T9 "MCPO", MCP OAuth) avoids colliding
 * with the web dev server while staying in the Inspector 627x family.
 *
 * Port 6276 is fixed so EMA, CIMD, and static OAuth apps can pre-register
 * `http://127.0.0.1:6276/oauth/callback`. Concurrent TUI OAuth on that port is
 * unsupported; override via `--callback-url` / `MCP_OAUTH_CALLBACK_URL`.
 */

import {
  formatHostForUrl,
  isLoopbackHost,
  stripBrackets,
} from "../../node/hostUrl.js";

export const RUNNER_OAUTH_CALLBACK_DEFAULT_HOSTNAME = "127.0.0.1";
/** Default loopback port for TUI/CLI OAuth callback (6276 ≈ T9 "MCPO", MCP OAuth). */
export const RUNNER_OAUTH_CALLBACK_DEFAULT_PORT = 6276;
export const RUNNER_OAUTH_CALLBACK_PATH = "/oauth/callback";

export const DEFAULT_RUNNER_OAUTH_CALLBACK_URL = `http://${RUNNER_OAUTH_CALLBACK_DEFAULT_HOSTNAME}:${RUNNER_OAUTH_CALLBACK_DEFAULT_PORT}${RUNNER_OAUTH_CALLBACK_PATH}`;

export interface RunnerOAuthCallbackConfig {
  hostname: string;
  port: number;
  pathname: string;
}

/**
 * Resolve the callback listener URL for TUI/CLI.
 * Precedence: CLI `--callback-url` → `MCP_OAUTH_CALLBACK_URL` → default 6276.
 * Pass `http://127.0.0.1:0/oauth/callback` for an OS-assigned ephemeral port.
 */
export function parseRunnerOAuthCallbackUrl(
  cliCallbackUrl?: string,
): RunnerOAuthCallbackConfig {
  const raw =
    cliCallbackUrl?.trim() || process.env.MCP_OAUTH_CALLBACK_URL?.trim() || "";
  if (!raw) {
    return {
      hostname: RUNNER_OAUTH_CALLBACK_DEFAULT_HOSTNAME,
      port: RUNNER_OAUTH_CALLBACK_DEFAULT_PORT,
      pathname: RUNNER_OAUTH_CALLBACK_PATH,
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch (err) {
    /* v8 ignore next -- new URL() only throws an Error with a message; the String(err) fallback is unreachable */
    const reason = (err as Error)?.message ?? String(err);
    throw new Error(`Invalid OAuth callback URL: ${reason}`, { cause: err });
  }
  if (url.protocol !== "http:") {
    throw new Error("OAuth callback URL must use http scheme");
  }
  const hostname = url.hostname;
  /* v8 ignore start -- a parseable http: URL always has a non-empty hostname; empty-host http URLs throw at new URL() above */
  if (!hostname) {
    throw new Error("OAuth callback URL must include a hostname");
  }
  /* v8 ignore stop */
  // The callback listener receives the OAuth *authorization code* over plaintext
  // http, so it must be loopback (RFC 8252 §7.3) — a routable host would deliver
  // the credential in cleartext over the network. Reject anything non-loopback,
  // not just the all-interfaces wildcard.
  if (!isLoopbackHost(hostname)) {
    throw new Error(
      `OAuth callback URL must bind a loopback host (localhost / 127.0.0.1 / ` +
        `[::1]), not "${hostname}": the callback listener receives the OAuth ` +
        `authorization code over plaintext http, so a network-reachable host ` +
        `risks credential interception. Use 127.0.0.1 (and a port-forward if the ` +
        `browser is elsewhere).`,
    );
  }
  /* v8 ignore next -- an http: URL always has a non-empty pathname (min "/"), so the fallback is unreachable */
  const pathname = url.pathname || "/";
  let port: number;
  if (url.port === "") {
    port = 80;
  } else {
    port = Number(url.port);
    /* v8 ignore start -- new URL() already rejects out-of-range/non-numeric ports, so url.port is always a valid 0-65535 numeric string here */
    if (
      !Number.isFinite(port) ||
      !Number.isInteger(port) ||
      port < 0 ||
      port > 65535
    ) {
      throw new Error("OAuth callback URL port must be between 0 and 65535");
    }
    /* v8 ignore stop */
  }
  // De-bracket an IPv6 host (`url.hostname` keeps the brackets) so `listen()` can
  // consume it — `[::1]` fails ENOTFOUND, `::1` binds. formatRunnerOAuthRedirectUrl
  // re-brackets via formatHostForUrl for the redirect URI.
  return { hostname: stripBrackets(hostname), port, pathname };
}

/**
 * Build the redirect_uri string sent to the authorization server.
 * Port 0 yields `…:0/…`; the TUI overwrites `redirectUrlProvider.redirectUrl`
 * with the bound listener URL before OAuth starts, so :0 is never sent to the AS.
 */
export function formatRunnerOAuthRedirectUrl(
  config: RunnerOAuthCallbackConfig,
): string {
  return `http://${formatHostForUrl(config.hostname)}:${config.port}${config.pathname}`;
}
