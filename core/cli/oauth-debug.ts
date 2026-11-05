/**
 * The terminal side of `--oauth-debug` (#2844), shared by the one-shot CLI and
 * mcpdo so both flags trace the same requests in the same words.
 *
 * The trace itself is `core/auth/oauthDebug.ts`; this file only decides where
 * it is wired in: under the OAuth base fetch (`environment.oauthFetch`) both
 * clients already hand `InspectorClient`, and on the armed navigation that
 * prints the authorize URL. Lines go to stderr, so `--format json` keeps a
 * clean stdout.
 */

import {
  describeAuthorizationUrl,
  withOAuthDebugTrace,
  type OAuthDebugWrite,
} from "../auth/oauthDebug.js";
import { createGuardedFetch } from "../mcp/node/fetchGuard.js";

/** The default trace sink: one line to stderr per call. */
export const writeOAuthDebugToStderr: OAuthDebugWrite = (line) => {
  process.stderr.write(line);
};

/**
 * The destination-guarded OAuth base fetch (#2749), traced when `oauthDebug`
 * is on. The trace sits *above* the guard, so a refused destination shows up
 * as a failed request rather than vanishing.
 */
export function createCliOAuthFetch(
  oauthDebug: boolean,
  write: OAuthDebugWrite = writeOAuthDebugToStderr,
): typeof fetch {
  return traceCliOAuthFetch(createGuardedFetch(), oauthDebug, write);
}

/**
 * `fetchFn`, traced when `oauthDebug` is on — for a path that composes its own
 * guarded base (the CLI's `--use-stored-auth` refresh, which also reports
 * guard refusals there).
 */
export function traceCliOAuthFetch(
  fetchFn: typeof fetch,
  oauthDebug: boolean,
  write: OAuthDebugWrite = writeOAuthDebugToStderr,
): typeof fetch {
  return oauthDebug ? withOAuthDebugTrace(fetchFn, write) : fetchFn;
}

/**
 * The `onAuthorizationUrl` hook for `createCliOAuthNavigation`, or `undefined`
 * when the trace is off.
 */
export function oauthDebugNavigationHook(
  oauthDebug: boolean,
  write: OAuthDebugWrite = writeOAuthDebugToStderr,
): ((url: URL) => void) | undefined {
  return oauthDebug ? (url) => write(describeAuthorizationUrl(url)) : undefined;
}
