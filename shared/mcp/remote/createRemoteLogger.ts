/**
 * Creates a pino logger that POSTs log events to the remote /api/log endpoint
 * via browser.transmit. Use in the browser when InspectorClient needs logging—
 * logs are written server-side to the same file logger as Node mode.
 *
 * Uses pino/browser so transmit works in both Node (tests) and browser.
 */

import pino from "pino/browser";
import type { Logger, LogEvent } from "pino";

export interface RemoteLoggerOptions {
  /** Base URL of the remote server (e.g. http://localhost:3000) */
  baseUrl: string;

  /** Optional auth token for x-mcp-remote-auth header */
  authToken?: string;

  /** Fetch function to use (default: globalThis.fetch) */
  fetchFn?: typeof fetch;

  /** Minimum level to send (default: 'info') */
  level?: string;
}

/**
 * Creates a pino logger that transmits log events to the remote /api/log endpoint.
 * Returns a real pino.Logger; suitable for InspectorClient's logger option.
 */
export function createRemoteLogger(options: RemoteLoggerOptions): Logger {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const level = options.level ?? "info";

  return pino({
    level,
    browser: {
      write: () => {},
      transmit: {
        level,
        send: (_level: unknown, logEvent: LogEvent) => {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (options.authToken) {
            headers["x-mcp-remote-auth"] = `Bearer ${options.authToken}`;
          }

          fetchFn(`${baseUrl}/api/log`, {
            method: "POST",
            headers,
            body: JSON.stringify(logEvent),
          }).catch(() => {
            // Silently ignore log delivery failures
          });
        },
      },
    },
  });
}
