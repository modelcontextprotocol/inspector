import { createServer, type Server } from "node:http";
import { parseOAuthCallbackParams } from "./utils.js";
import { generateOAuthErrorDescription } from "./utils.js";

const OAUTH_CALLBACK_PATH = "/oauth/callback";
const OAUTH_CALLBACK_GUIDED_PATH = "/oauth/callback/guided";

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth complete</title></head>
<body><p>OAuth complete. You can close this window.</p></body>
</html>`;

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OAuth error</title></head>
<body><p>OAuth failed: ${escapeHtml(message)}</p></body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type OAuthCallbackHandler = (params: {
  code: string;
  state?: string;
}) => Promise<void>;

export type OAuthErrorHandler = (params: {
  error: string;
  error_description?: string | null;
}) => void;

export interface OAuthCallbackServerStartOptions {
  port?: number;
  onCallback?: OAuthCallbackHandler;
  onError?: OAuthErrorHandler;
}

export interface OAuthCallbackServerStartResult {
  port: number;
  redirectUrl: string;
  redirectUrlGuided: string;
}

/**
 * Minimal HTTP server that receives OAuth 2.1 redirects at GET /oauth/callback.
 * Used by TUI/CLI to complete the authorization code flow (normal mode only).
 * Caller provides onCallback/onError; typically onCallback calls
 * InspectorClient.completeOAuthFlow(code) then stops the server.
 */
export class OAuthCallbackServer {
  private server: Server | null = null;
  private port: number = 0;
  private handled = false;
  private onCallback?: OAuthCallbackHandler;
  private onError?: OAuthErrorHandler;

  /**
   * Start the server. Listens on the given port (default 0 = random).
   * Returns port and redirectUrl for use as oauth.redirectUrl.
   */
  async start(
    options: OAuthCallbackServerStartOptions = {},
  ): Promise<OAuthCallbackServerStartResult> {
    const { port = 0, onCallback, onError } = options;
    this.onCallback = onCallback;
    this.onError = onError;
    this.handled = false;

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.on("error", reject);
      this.server.listen(port, "127.0.0.1", () => {
        const a = this.server!.address();
        if (!a || typeof a === "string") {
          reject(new Error("Failed to get server address"));
          return;
        }
        this.port = a.port;
        resolve({
          port: this.port,
          redirectUrl: `http://localhost:${this.port}${OAUTH_CALLBACK_PATH}`,
          redirectUrlGuided: `http://localhost:${this.port}${OAUTH_CALLBACK_GUIDED_PATH}`,
        });
      });
    });
  }

  /**
   * Stop the server. Idempotent.
   */
  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
    });
    this.server = null;
  }

  private handleRequest(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse<
      import("node:http").IncomingMessage
    >,
  ): void {
    const needJson = req.headers["accept"]?.includes("application/json");

    const send = (
      status: number,
      body: string,
      contentType = "text/html; charset=utf-8",
    ) => {
      res.writeHead(status, { "Content-Type": contentType });
      res.end(body);
    };

    if (req.method !== "GET") {
      send(405, needJson ? '{"error":"Method Not Allowed"}' : SUCCESS_HTML);
      return;
    }

    let pathname: string;
    let search: string;
    let state: string | undefined;
    try {
      const u = new URL(req.url ?? "", "http://localhost");
      pathname = u.pathname;
      search = u.search;
      state = u.searchParams.get("state") ?? undefined;
    } catch {
      send(400, needJson ? '{"error":"Bad Request"}' : SUCCESS_HTML);
      return;
    }

    if (
      pathname !== OAUTH_CALLBACK_PATH &&
      pathname !== OAUTH_CALLBACK_GUIDED_PATH
    ) {
      send(404, needJson ? '{"error":"Not Found"}' : SUCCESS_HTML);
      return;
    }

    if (this.handled) {
      send(
        409,
        needJson ? '{"error":"Callback already handled"}' : SUCCESS_HTML,
      );
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
      } else {
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
export function createOAuthCallbackServer(): OAuthCallbackServer {
  return new OAuthCallbackServer();
}
