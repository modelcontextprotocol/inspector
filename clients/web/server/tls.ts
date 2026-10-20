/**
 * Optional TLS for the Inspector web listener (#2446).
 *
 * TLS is on only when BOTH `INSPECTOR_TLS_KEY_PATH` and
 * `INSPECTOR_TLS_CERT_PATH` are set. Both callers — the prod Hono server and
 * the Vite dev server — read the same resolved pair off `WebServerConfig.tls`,
 * so dev and prod cannot disagree about whether the UI is on https.
 *
 * Every failure is a startup error rather than a fallback to plain http: a
 * user who configured a certificate and silently gets http instead would see
 * their https origin 403 (or the page refuse to load) with nothing pointing
 * at the cause. So a half-configured pair, an unreadable file, and a key and
 * certificate Node cannot use together all throw, each with a message naming
 * the variable(s) involved instead of a raw `ENOENT` or OpenSSL stack.
 *
 * Only the UI listener is covered. The MCP Apps sandbox and app-origin
 * listeners stay plain http — browsers treat loopback http as a secure
 * context, and a public deployment fronts them with a proxy via
 * `MCP_SANDBOX_FULL_ADDRESS` / `MCP_APP_ORIGIN_FULL_ADDRESS` (see docs/tls.md).
 */

import { readFileSync } from "node:fs";
import { createSecureContext } from "node:tls";

export const TLS_KEY_PATH_ENV = "INSPECTOR_TLS_KEY_PATH";
export const TLS_CERT_PATH_ENV = "INSPECTOR_TLS_CERT_PATH";

/**
 * The PEM key and certificate the listener serves. Shaped to drop straight
 * into `https.createServer` options and Vite's `server.https`.
 */
export interface TlsConfig {
  key: string;
  cert: string;
}

/** The URL scheme the web listener serves, given its resolved TLS config. */
export function webScheme(tls: TlsConfig | undefined): "http" | "https" {
  return tls ? "https" : "http";
}

function readPem(env: string, path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    // A filesystem error always carries `code` (ENOENT, EACCES, EISDIR, …);
    // the code alone names the cause without the raw `open '<path>'` message.
    const { code } = err as NodeJS.ErrnoException;
    throw new Error(
      `Cannot read ${env}="${path}" (${code}): check that the file exists and is readable.`,
      { cause: err },
    );
  }
}

/**
 * Resolve the TLS pair from the environment, or `undefined` when neither
 * variable is set. A blank value counts as unset, matching how the other web
 * variables (`CLIENT_PORT`, `HOST`) treat an empty string.
 *
 * @throws when only one of the two is set, when either file cannot be read,
 *   or when the two do not form a usable key/certificate pair.
 */
export function resolveTlsConfig(
  env: NodeJS.ProcessEnv = process.env,
): TlsConfig | undefined {
  const keyPath = env[TLS_KEY_PATH_ENV]?.trim();
  const certPath = env[TLS_CERT_PATH_ENV]?.trim();
  if (!keyPath && !certPath) return undefined;
  if (!keyPath || !certPath) {
    const missing = keyPath ? TLS_CERT_PATH_ENV : TLS_KEY_PATH_ENV;
    throw new Error(
      `TLS needs both ${TLS_KEY_PATH_ENV} and ${TLS_CERT_PATH_ENV}; ${missing} is not set. Set both to enable https, or neither for plain http.`,
    );
  }
  const key = readPem(TLS_KEY_PATH_ENV, keyPath);
  const cert = readPem(TLS_CERT_PATH_ENV, certPath);
  // Validate the pair now rather than at bind time, where the same OpenSSL
  // error surfaces from inside the server constructor with no hint of which
  // variable to fix. Catches a non-PEM file and a key that does not match the
  // certificate alike.
  try {
    createSecureContext({ key, cert });
  } catch (err) {
    // createSecureContext only throws Error instances (OpenSSL failures).
    const reason = (err as Error).message;
    throw new Error(
      `${TLS_KEY_PATH_ENV}="${keyPath}" and ${TLS_CERT_PATH_ENV}="${certPath}" are not a usable PEM key/certificate pair (${reason}).`,
      { cause: err },
    );
  }
  return { key, cert };
}
