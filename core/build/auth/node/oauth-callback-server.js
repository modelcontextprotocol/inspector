import { createServer } from "node:http";
import { parseOAuthCallbackParams } from "../utils.js";
import { generateOAuthErrorDescription } from "../utils.js";
const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_CALLBACK_PATH = "/oauth/callback";
const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth complete</title></head>
<body><p>OAuth complete. You can close this window.</p></body>
</html>`;
function errorHtml(message) {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth error</title></head>
<body><p>OAuth failed: ${escapeHtml(message)}</p></body>
</html>`;
}
function escapeHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
/**
 * Minimal HTTP server that receives OAuth 2.1 redirects at GET /oauth/callback.
 * Used by TUI/CLI to complete the authorization code flow (both normal and guided).
 * Caller provides onCallback/onError; typically onCallback calls
 * InspectorClient.completeOAuthFlow(code) then stops the server.
 */
export class OAuthCallbackServer {
    server = null;
    port = 0;
    hostname = DEFAULT_HOSTNAME;
    callbackPath = DEFAULT_CALLBACK_PATH;
    handled = false;
    onCallback;
    onError;
    /**
     * Start the server. Listens on the given port (default 0 = random).
     * Returns port and redirectUrl for use as oauth.redirectUrl.
     */
    async start(options = {}) {
        const { port = 0, hostname = DEFAULT_HOSTNAME, path = DEFAULT_CALLBACK_PATH, onCallback, onError, } = options;
        if (!path.startsWith("/")) {
            return Promise.reject(new Error("Callback path must start with '/' (absolute path)"));
        }
        this.onCallback = onCallback;
        this.onError = onError;
        this.handled = false;
        this.hostname = hostname;
        this.callbackPath = path;
        return new Promise((resolve, reject) => {
            this.server = createServer((req, res) => this.handleRequest(req, res));
            this.server.on("error", reject);
            this.server.listen(port, hostname, () => {
                const a = this.server.address();
                if (!a || typeof a === "string") {
                    reject(new Error("Failed to get server address"));
                    return;
                }
                this.port = a.port;
                resolve({
                    port: this.port,
                    redirectUrl: buildRedirectUrl(hostname, this.port, path),
                });
            });
        });
    }
    /**
     * Stop the server. Idempotent.
     */
    async stop() {
        if (!this.server)
            return;
        await new Promise((resolve) => {
            this.server.close(() => resolve());
        });
        this.server = null;
    }
    handleRequest(req, res) {
        const needJson = req.headers["accept"]?.includes("application/json");
        const send = (status, body, contentType = "text/html; charset=utf-8") => {
            res.writeHead(status, { "Content-Type": contentType });
            res.end(body);
        };
        if (req.method !== "GET") {
            send(405, needJson ? '{"error":"Method Not Allowed"}' : SUCCESS_HTML);
            return;
        }
        let pathname;
        let search;
        let state;
        try {
            const u = new URL(req.url ?? "", "http://placeholder");
            pathname = u.pathname;
            search = u.search;
            state = u.searchParams.get("state") ?? undefined;
        }
        catch {
            send(400, needJson ? '{"error":"Bad Request"}' : SUCCESS_HTML);
            return;
        }
        if (pathname !== this.callbackPath) {
            send(404, needJson ? '{"error":"Not Found"}' : SUCCESS_HTML);
            return;
        }
        if (this.handled) {
            send(409, needJson ? '{"error":"Callback already handled"}' : SUCCESS_HTML);
            return;
        }
        const params = parseOAuthCallbackParams(search);
        if (params.successful) {
            this.handled = true;
            const cb = this.onCallback;
            if (cb) {
                cb({ code: params.code, state })
                    .then(() => {
                    send(200, SUCCESS_HTML);
                    void this.stop();
                })
                    .catch((err) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.onError?.({ error: "callback_error", error_description: msg });
                    send(500, errorHtml(msg));
                    void this.stop();
                });
            }
            else {
                send(200, SUCCESS_HTML);
                void this.stop();
            }
            return;
        }
        this.handled = true;
        const msg = generateOAuthErrorDescription(params);
        this.onError?.({
            error: params.error,
            error_description: params.error_description ?? undefined,
        });
        send(400, errorHtml(msg));
    }
}
/**
 * Create an OAuth callback server instance.
 * Use start() then stop() when the OAuth flow is done.
 */
export function createOAuthCallbackServer() {
    return new OAuthCallbackServer();
}
function buildRedirectUrl(host, port, path) {
    const needsBrackets = host.includes(":") && !host.startsWith("[");
    const formattedHost = needsBrackets ? `[${host}]` : host;
    return `http://${formattedHost}:${port}${path}`;
}
//# sourceMappingURL=oauth-callback-server.js.map