/**
 * Default OAuth callback URL for Node runners (TUI / CLI).
 *
 * Web uses the main Hono server (`localhost:6274` by default). Runners spin up
 * a minimal loopback listener; default port 6276 (T9 "MCPO", MCP OAuth) avoids colliding
 * with the web dev server while staying in the Inspector 627x family.
 */

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
    cliCallbackUrl?.trim() ||
    process.env.MCP_OAUTH_CALLBACK_URL?.trim() ||
    "";
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
    throw new Error(
      `Invalid OAuth callback URL: ${(err as Error)?.message ?? String(err)}`,
    );
  }
  if (url.protocol !== "http:") {
    throw new Error("OAuth callback URL must use http scheme");
  }
  const hostname = url.hostname;
  if (!hostname) {
    throw new Error("OAuth callback URL must include a hostname");
  }
  const pathname = url.pathname || "/";
  let port: number;
  if (url.port === "") {
    port = 80;
  } else {
    port = Number(url.port);
    if (
      !Number.isFinite(port) ||
      !Number.isInteger(port) ||
      port < 0 ||
      port > 65535
    ) {
      throw new Error("OAuth callback URL port must be between 0 and 65535");
    }
  }
  return { hostname, port, pathname };
}

/**
 * Build the redirect_uri string sent to the authorization server.
 * Port 0 yields `…:0/…`; the TUI overwrites `redirectUrlProvider.redirectUrl`
 * with the bound listener URL before OAuth starts, so :0 is never sent to the AS.
 */
export function formatRunnerOAuthRedirectUrl(
  config: RunnerOAuthCallbackConfig,
): string {
  const needsBrackets =
    config.hostname.includes(":") && !config.hostname.startsWith("[");
  const formattedHost = needsBrackets
    ? `[${config.hostname}]`
    : config.hostname;
  return `http://${formattedHost}:${config.port}${config.pathname}`;
}
