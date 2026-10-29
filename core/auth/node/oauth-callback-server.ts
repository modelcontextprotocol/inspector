import { createServer, type Server } from "node:http";
import { formatHostForUrl } from "../../node/hostUrl.js";
import { parseOAuthCallbackParams } from "../utils.js";
import { generateOAuthErrorDescription } from "../utils.js";

const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_CALLBACK_PATH = "/oauth/callback";

const SUCCESS_HTML = page(
  "OAuth complete",
  "OAuth complete. You can close this window.",
);

/**
 * Body for every request that is not the OAuth callback at all — a wrong
 * path, a non-GET method, an unparseable target (#2843). These used to send
 * {@link SUCCESS_HTML} under a 404/405/400 status, telling a user who opened
 * the wrong URL that sign-in had finished while the CLI/TUI was still
 * waiting for the real redirect.
 */
const NOT_CALLBACK_HTML = page(
  "Not the OAuth callback",
  "This address is not the OAuth callback the Inspector is waiting for. " +
    "Sign-in has not finished; return to the Inspector to continue.",
);

/**
 * Body for a callback whose `state` is not the flow in progress (#2847). Such
 * a request is ignored rather than allowed to end the flow, so this page must
 * not claim sign-in finished — or failed — either.
 */
const STATE_MISMATCH_HTML = page(
  "OAuth callback ignored",
  "This callback does not belong to the sign-in in progress and was ignored. " +
    "Sign-in has not finished; the Inspector is still waiting for the " +
    "authorization server.",
);

const ALREADY_HANDLED_HTML = page(
  "OAuth callback already received",
  "This sign-in has already received its callback. You can close this window.",
);

const STOPPED_HTML = page(
  "OAuth callback not expected",
  "The Inspector is no longer waiting for this sign-in. " +
    "Start sign-in again from the Inspector.",
);

/**
 * Error page for an authorization-server error response. The text after the
 * label comes from the redirect's query string, i.e. from whoever produced
 * the request, so it is labeled as the server's words rather than presented
 * as the Inspector's own diagnosis (#2847).
 */
function errorHtml(serverText: string): string {
  return page(
    "OAuth error",
    `OAuth failed. The authorization server said: ${serverText}`,
  );
}

/** Failure of the Inspector's own token exchange after a matching callback. */
function exchangeErrorHtml(message: string): string {
  return page("OAuth error", `OAuth failed: ${message}`);
}

function page(title: string, text: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body><p>${escapeHtml(text)}</p></body>
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
  /** RFC 9207 `iss`, when the authorization server sends it. */
  iss?: string;
}) => Promise<void>;

export type OAuthErrorHandler = (params: {
  error: string;
  error_description?: string | null;
}) => void;

export interface OAuthCallbackServerStartOptions {
  port?: number;
  hostname?: string;
  path?: string;
  onCallback?: OAuthCallbackHandler;
  onError?: OAuthErrorHandler;
  /**
   * The OAuth `state` of the flow this listener serves (#2847). Only a
   * callback carrying exactly this `state` — success **or** error response —
   * is acted on; any other gets a short 400 and the listener keeps waiting,
   * so a local process or a web page that can make the browser hit the
   * fixed loopback port can neither cancel the sign-in nor choose the text
   * it reports.
   *
   * A promise, because the listener has to be bound (its URL is the
   * `redirect_uri`) before the authorize URL — and so the `state` — exists.
   * A callback that arrives before it settles is held until it does, which
   * is what keeps an authorization server that redirects immediately from
   * racing the caller. Resolving `undefined` means the flow carries no
   * `state`, so only a callback without one matches.
   *
   * Omitted, no `state` check is made and the first callback ends the flow;
   * that is only appropriate for a host that verifies `state` itself.
   */
  expectedState?: string | Promise<string | undefined>;
}

export interface OAuthCallbackServerStartResult {
  port: number;
  redirectUrl: string;
}

/** No `expectedState` was given: accept a callback whatever its `state`. */
const ANY_STATE = Symbol("any-state");
/** The listener stopped while a callback waited on `expectedState`. */
const STOPPED = Symbol("stopped");

/** A promise that settles to {@link STOPPED} once `fire()` is called. */
function createStopSignal(): {
  stopped: Promise<typeof STOPPED>;
  fire: () => void;
} {
  let fire!: () => void;
  const stopped = new Promise<typeof STOPPED>((resolve) => {
    fire = () => resolve(STOPPED);
  });
  return { stopped, fire };
}

/**
 * Minimal HTTP server that receives OAuth 2.1 redirects at GET /oauth/callback.
 * Used by TUI/CLI to complete the authorization code flow.
 * Caller provides onCallback/onError; typically onCallback calls
 * InspectorClient.completeOAuthFlow(code) then stops the server.
 */
export class OAuthCallbackServer {
  private server: Server | null = null;
  private port: number = 0;
  private callbackPath: string = DEFAULT_CALLBACK_PATH;
  private handled = false;
  private onCallback?: OAuthCallbackHandler;
  private onError?: OAuthErrorHandler;
  private expectedState: Promise<
    string | undefined | typeof ANY_STATE | typeof STOPPED
  > = Promise.resolve(ANY_STATE);
  private stopSignal = createStopSignal();

  /**
   * Start the server. Port defaults to 0 (random) when omitted; TUI/CLI callers
   * pass the resolved port from {@link parseRunnerOAuthCallbackUrl} (6276 by default).
   * Returns port and redirectUrl for use as oauth.redirectUrl.
   */
  async start(
    options: OAuthCallbackServerStartOptions = {},
  ): Promise<OAuthCallbackServerStartResult> {
    const {
      port = 0,
      hostname = DEFAULT_HOSTNAME,
      path = DEFAULT_CALLBACK_PATH,
      onCallback,
      onError,
    } = options;
    if (!path.startsWith("/")) {
      return Promise.reject(
        new Error("Callback path must start with '/' (absolute path)"),
      );
    }
    this.onCallback = onCallback;
    this.onError = onError;
    this.handled = false;
    this.callbackPath = path;
    // A rejected expectedState names no flow, so it is read as "stopped":
    // nothing can match it, and the waiting callback must still be answered.
    this.expectedState =
      "expectedState" in options
        ? Promise.resolve(options.expectedState).catch(() => STOPPED)
        : Promise.resolve(ANY_STATE);
    this.stopSignal = createStopSignal();

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.on("error", reject);
      this.server.listen(port, hostname, () => {
        const a = this.server!.address();
        /* v8 ignore next 4 -- defensive: a TCP server that has fired its
           `listen` callback always reports an AddressInfo object (never null
           and never a string, which only happens for a pipe/unix socket),
           so this guard is unreachable from a successful `listen(port, host)`. */
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
   * Stop the server. Idempotent. A callback still waiting on
   * `expectedState` is answered first, since `close()` waits for every open
   * request to finish.
   */
  async stop(): Promise<void> {
    if (!this.server) return;
    this.stopSignal.fire();
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
      // A one-shot loopback listener gains nothing from keep-alive, and a
      // kept-alive socket holds `stop()`'s `close()` open after the last
      // response — including the 503 a held callback gets on stop.
      res.writeHead(status, {
        "Content-Type": contentType,
        Connection: "close",
      });
      res.end(body);
    };

    if (req.method !== "GET") {
      send(
        405,
        needJson ? '{"error":"Method Not Allowed"}' : NOT_CALLBACK_HTML,
      );
      return;
    }

    let pathname: string;
    let search: string;
    let state: string | undefined;
    try {
      const u = new URL(
        /* v8 ignore next -- defensive: Node always populates req.url for an
           HTTP request, so the `?? ""` fallback is never taken. */
        req.url ?? "",
        "http://placeholder",
      );
      pathname = u.pathname;
      search = u.search;
      state = u.searchParams.get("state") ?? undefined;
    } catch {
      send(400, needJson ? '{"error":"Bad Request"}' : NOT_CALLBACK_HTML);
      return;
    }

    if (pathname !== this.callbackPath) {
      send(404, needJson ? '{"error":"Not Found"}' : NOT_CALLBACK_HTML);
      return;
    }

    // void: the promise owns its outcome — every branch of handleCallback
    // answers the request, and it has no rejection path to surface.
    void Promise.race([this.expectedState, this.stopSignal.stopped]).then(
      (expected) =>
        this.handleCallback(expected, state, search, needJson, send),
    );
  }

  private handleCallback(
    expected: string | undefined | typeof ANY_STATE | typeof STOPPED,
    state: string | undefined,
    search: string,
    needJson: boolean | undefined,
    send: (status: number, body: string) => void,
  ): void {
    if (expected === STOPPED) {
      send(
        503,
        needJson ? '{"error":"Not waiting for a callback"}' : STOPPED_HTML,
      );
      return;
    }

    // #2847: a callback that is not for this flow — success or error
    // response alike — is ignored, and the listener keeps waiting for the
    // one that is (or for the caller's timeout).
    if (expected !== ANY_STATE && state !== expected) {
      send(400, needJson ? '{"error":"State mismatch"}' : STATE_MISMATCH_HTML);
      return;
    }

    if (this.handled) {
      send(
        409,
        needJson
          ? '{"error":"Callback already handled"}'
          : ALREADY_HANDLED_HTML,
      );
      return;
    }

    const params = parseOAuthCallbackParams(search);

    if (params.successful) {
      this.handled = true;
      const cb = this.onCallback;
      if (cb) {
        cb({ code: params.code, state, iss: params.iss })
          .then(() => {
            send(200, SUCCESS_HTML);
            void this.stop();
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.onError?.({ error: "callback_error", error_description: msg });
            send(500, exchangeErrorHtml(msg));
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

function buildRedirectUrl(host: string, port: number, path: string): string {
  return `http://${formatHostForUrl(host)}:${port}${path}`;
}
