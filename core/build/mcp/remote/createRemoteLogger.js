/**
 * Creates a pino logger that POSTs log events to the remote /api/log endpoint
 * via browser.transmit. Use in the browser when InspectorClient needs logging—
 * logs are written server-side to the same file logger as Node mode.
 *
 * Uses pino/browser so transmit works in both Node (tests) and browser.
 */
// @ts-expect-error - pino/browser.js exists but TypeScript doesn't have types for the .js extension
// Node.js ESM requires explicit .js extension, and pino exports browser.js
import pino from "pino/browser.js";
/**
 * Creates a pino logger that transmits log events to the remote /api/log endpoint.
 * Returns a real pino.Logger; suitable for InspectorClient's logger option.
 */
export function createRemoteLogger(options) {
    const baseUrl = options.baseUrl.replace(/\/$/, "");
    const fetchFn = options.fetchFn ?? globalThis.fetch;
    const level = options.level ?? "info";
    return pino({
        level,
        browser: {
            write: () => { },
            transmit: {
                level,
                send: (_level, logEvent) => {
                    const headers = {
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
//# sourceMappingURL=createRemoteLogger.js.map