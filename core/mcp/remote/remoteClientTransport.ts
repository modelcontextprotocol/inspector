/**
 * RemoteClientTransport - Transport that talks to a remote server via HTTP.
 * Pure TypeScript; works in browser, Deno, or Node.
 */

import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/client";
import type {
  JSONRPCMessage,
  MessageExtraInfo,
} from "@modelcontextprotocol/client";
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { findHeader, isLongLivedStreamResponse } from "../fetchTracking.js";
import type { InspectorServerSettings, StderrLogEntry } from "../types.js";
import type { FetchRequestEntryBase, FetchStreamState } from "../types.js";
import type {
  AuthChallenge,
  AuthChallengeOutcome,
  HandleAuthChallengeOptions,
} from "../../auth/challenge.js";
import {
  AuthChallengeError,
  AuthRecoveryRequiredError,
  EMA_STEP_UP_PENDING_URL,
} from "../../auth/challenge.js";
import type {
  RemoteConnectRequest,
  RemoteConnectResponse,
  RemoteAuthState,
  RemoteEvent,
  RemoteSendResponse,
} from "./types.js";
import { oauthTokensToRemoteAuthState } from "./types.js";
import { progressTokenOf, waitForProgressToken } from "./progressToken.js";

export interface AuthRecoveryHandlers {
  handleAuthChallenge(
    challenge: AuthChallenge,
    options?: HandleAuthChallengeOptions,
  ): Promise<AuthChallengeOutcome>;
  /** Push recovered auth state to the remote backend (same session). */
  pushAuthState?: (authState?: RemoteAuthState) => Promise<void>;
}

export interface RemoteTransportOptions {
  /** Base URL of the remote server (e.g. http://localhost:3000) */
  baseUrl: string;

  /** Optional auth token for x-mcp-remote-auth header */
  authToken?: string;

  /** Optional fetch implementation (for proxy or testing) */
  fetchFn?: typeof fetch;

  /** Callback for stderr from stdio transports (forwarded via remote) */
  onStderr?: (entry: StderrLogEntry) => void;

  /** Callback for fetch request tracking (forwarded via remote) */
  onFetchRequest?: (entry: FetchRequestEntryBase) => void;

  /** Callback for async response-body updates to a previously tracked fetch. */
  onFetchResponseBody?: (id: string, responseBody: string) => void;

  /** Callback for a previously tracked long-lived stream's events and close (#2318). */
  onFetchStreamUpdate?: (id: string, stream: FetchStreamState) => void;

  /** Optional OAuth client provider for Bearer authentication */
  authProvider?: import("@modelcontextprotocol/client").OAuthClientProvider;

  /**
   * Optional per-server settings forwarded in the /api/mcp/connect body.
   * The backend uses settings.headers as the source of truth for transport
   * custom headers (SSE / streamable-http).
   */
  settings?: InspectorServerSettings;

  /** Mid-session auth recovery (handle challenge on command-scoped send). */
  authRecovery?: AuthRecoveryHandlers;

  /** Ambient auth challenges delivered via SSE (no active send). */
  onAuthChallenge?: (challenge: AuthChallenge) => void;

  /** Max wait for a JSON-RPC response on SSE after HTTP `{ ok: true }`. Default 60s. */
  sseResponseTimeoutMs?: number;
}

const DEFAULT_SSE_RESPONSE_TIMEOUT_MS = 60_000;

type SseResponseWait = {
  resolve: () => void;
  reject: (error: Error) => void;
  /**
   * Re-arm this wait's timeout for another full window when a
   * `notifications/progress` for the request arrives, mirroring the SDK
   * client's `resetTimeoutOnProgress` (#2028).
   */
  resetTimeout: () => void;
};

function requestIdForMessage(
  message: JSONRPCMessage,
): string | number | undefined {
  if (
    "method" in message &&
    "id" in message &&
    message.id !== null &&
    message.id !== undefined
  ) {
    // `subscriptions/listen` (modern era, #1630) is a long-lived stream request
    // with no JSON-RPC response — it's answered by a
    // `notifications/subscriptions/acknowledged` (delivered over the SSE event
    // channel) and, only on graceful close, an empty result. Waiting on a
    // response here would time out `send()` and, via the SDK's `listen()`,
    // spuriously drive the stream's `closed`/reconnect. Don't wait.
    if (message.method === "subscriptions/listen") {
      return undefined;
    }
    return message.id;
  }
  return undefined;
}

function isConnectAuthChallenge(
  json: RemoteConnectResponse,
): json is Extract<
  RemoteConnectResponse,
  { ok: false; kind: "auth_challenge" }
> {
  return (
    typeof json === "object" &&
    json !== null &&
    "ok" in json &&
    json.ok === false &&
    "kind" in json &&
    json.kind === "auth_challenge"
  );
}

function isConnectTransportError(
  json: RemoteConnectResponse,
): json is Extract<
  RemoteConnectResponse,
  { ok: false; kind: "transport_error" }
> {
  return (
    typeof json === "object" &&
    json !== null &&
    "ok" in json &&
    json.ok === false &&
    "kind" in json &&
    json.kind === "transport_error"
  );
}

function legacySessionId(json: RemoteConnectResponse): string | undefined {
  if (
    typeof json === "object" &&
    json !== null &&
    "sessionId" in json &&
    typeof json.sessionId === "string" &&
    !("ok" in json)
  ) {
    return json.sessionId;
  }
  if (
    typeof json === "object" &&
    json !== null &&
    "ok" in json &&
    json.ok === true &&
    "sessionId" in json
  ) {
    return json.sessionId;
  }
  return undefined;
}

/**
 * Parse an SSE stream from a ReadableStream.
 * Yields `{ event, data }` for each complete SSE message.
 *
 * ⚠️ **The in-progress event must live OUTSIDE the read loop.** A `read()`
 * returns an arbitrary slice of bytes, not a whole frame, so a frame's `data:`
 * line can arrive in one chunk and the blank line terminating it in the next.
 * Declaring `currentEvent` / `currentData` inside the loop — which this did
 * until #2134 — discards the accumulated payload at that boundary: the frame is
 * never yielded, the JSON-RPC response it carried never settles, and the caller
 * hangs forever with no error on any channel. `buffer` already carries a partial
 * *line* across reads; these carry the partial *frame*.
 *
 * It survived because Chromium and Firefox happen to deliver whole frames at the
 * payload sizes this transport sees. That is luck rather than a guarantee —
 * chunk boundaries are a function of payload size, TCP segmentation and any
 * intermediary — and the exposure grows with payload size, so a large
 * `resources/read` is the most likely first victim.
 *
 * Exported for `clients/web/src/test/core/mcp/remote/parseSSE.test.ts`, which is
 * the only way to reach the defect deterministically: driving a real transport
 * cannot steer where the chunk boundary lands, but a test that supplies the
 * reader can put it exactly on the terminator.
 */
export async function* parseSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const decoder = new TextDecoder();
  let buffer = "";
  // Carried ACROSS reads, not per chunk — see the header.
  let currentEvent = "message";
  let currentData: string[] = [];

  const consume = (line: string): { event: string; data: string } | null => {
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      currentData.push(line.slice(5).trimStart());
    } else if (line === "") {
      const complete =
        currentData.length > 0
          ? { event: currentEvent, data: currentData.join("\n") }
          : null;
      currentEvent = "message";
      currentData = [];
      return complete;
    }
    // Anything else (a `:` keep-alive comment, `id:`, `retry:`) is ignored.
    return null;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    /* v8 ignore next -- String.split always returns a non-empty array, so pop() is never undefined; the ?? "" fallback is unreachable. */
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const complete = consume(line);
      if (complete) yield complete;
    }
  }

  // Stream ended: flush the trailing partial line, then anything still held. A
  // server that closes without a final blank line has still delivered a complete
  // frame, and dropping it would lose the last message of every such stream.
  if (buffer) {
    const complete = consume(buffer);
    if (complete) yield complete;
  }
  if (currentData.length > 0) {
    yield { event: currentEvent, data: currentData.join("\n") };
  }
}

/**
 * Transport that forwards JSON-RPC to a remote server and receives responses via SSE.
 */
export class RemoteClientTransport implements Transport {
  private _sessionId: string | undefined = undefined;
  private _protocolVersion: string | undefined = undefined;
  private eventStreamReader: ReadableStreamDefaultReader<Uint8Array> | null =
    null;
  private eventStreamAbort: AbortController | null = null;
  private eventStreamConsumeTask: Promise<void> | null = null;
  private restartingEventStream = false;
  private closed = false;
  /**
   * Long-lived streams the backend has reported open, by fetch entry id, with
   * the last event count seen for each. `close()` reports them closed
   * itself: it aborts the event channel before asking the backend to
   * disconnect, so the backend watcher's own close report lands on an
   * unconsumed queue and is lost with the session (#2318).
   */
  private openStreams = new Map<string, number>();
  private readonly sseResponseWaits = new Map<
    string | number,
    SseResponseWait
  >();
  private readonly options: RemoteTransportOptions;
  private readonly config: import("../types.js").MCPServerConfig;

  /**
   * Whether the upstream connection gives each request its own response stream
   * (#2140). The SDK's `Protocol.request` reads this: on a 2026-era connection
   * a transport advertising it has its per-request stream **aborted** as the
   * spec's cancellation signal, and no `notifications/cancelled` is sent; a
   * transport that does not gets the stdio mechanism instead.
   *
   * The real upstream transport lives on the backend, so this transport has to
   * answer for it. Streamable HTTP opens one POST — and one SSE response
   * stream — per request, so it qualifies; stdio and SSE multiplex every
   * request over one shared channel and must keep sending the notification.
   *
   * Advertising it is only half the fix: `requestSend` applies the SDK's
   * `requestSignal` to the browser-to-backend fetch, and `/api/mcp/send`
   * forwards that disconnect to the upstream `transport.send`, which is what
   * actually closes the stream the server is watching.
   */
  readonly hasPerRequestStream: boolean;

  /**
   * Intentionally returns undefined. The MCP Client checks transport.sessionId to detect
   * reconnects and skip initialize. Our _sessionId is the remote server's session ID, not
   * the MCP protocol's initialization state. Exposing it would cause the MCP Client to
   * skip initialize and send tools/list first, which fails on streamable-http (and any
   * transport requiring initialize before other requests).
   */
  get sessionId(): string | undefined {
    return undefined;
  }

  /** Remote Hono session id (distinct from MCP protocol session). */
  getRemoteBackendSessionId(): string | undefined {
    return this._sessionId;
  }

  /**
   * The SDK Client calls this with the negotiated protocol version as soon as
   * `initialize` resolves — before it sends `notifications/initialized` — so an
   * HTTP transport can stamp `Mcp-Protocol-Version` on every later request.
   *
   * Here the real upstream transport lives on the backend, so we can only
   * record the version and forward it on the next `/api/mcp/send`, which
   * applies it to the upstream transport *before* sending. Because
   * `notifications/initialized` is that next send, it and everything after it
   * (including the standalone SSE GET and the session DELETE, both issued by
   * the upstream transport itself) carry the header (#1935).
   */
  setProtocolVersion(version: string): void {
    this._protocolVersion = version;
  }

  /**
   * Reattach to an existing remote backend session after a full-page OAuth
   * redirect. Opens the SSE event stream without POST /connect.
   */
  async attachToSession(sessionId: string): Promise<void> {
    if (this.closed) {
      this.closed = false;
    }
    await this.stopEventStream();
    this._sessionId = sessionId;
    await this.openEventStream();
  }

  constructor(
    options: RemoteTransportOptions,
    config: import("../types.js").MCPServerConfig,
  ) {
    this.options = options;
    this.config = config;
    this.hasPerRequestStream = config.type === "streamable-http";
  }

  setAuthRecovery(handlers: AuthRecoveryHandlers | undefined): void {
    this.options.authRecovery = handlers;
  }

  setOnAuthChallenge(
    handler: ((challenge: AuthChallenge) => void) | undefined,
  ): void {
    this.options.onAuthChallenge = handler;
  }

  private get fetchFn(): typeof fetch {
    return this.options.fetchFn ?? globalThis.fetch;
  }

  private get baseUrl(): string {
    return this.options.baseUrl.replace(/\/$/, "");
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.options.authToken) {
      h["x-mcp-remote-auth"] = `Bearer ${this.options.authToken}`;
    }
    return h;
  }

  private async recoverFromAuthChallenge(
    challenge: AuthChallenge,
    retry: () => Promise<void>,
  ): Promise<void> {
    const recovery = this.options.authRecovery;
    if (!recovery) {
      throw new AuthChallengeError(challenge, challenge.raw?.httpStatus ?? 401);
    }

    const outcome = await recovery.handleAuthChallenge(challenge);
    if (outcome.kind === "satisfied") {
      await retry();
      return;
    }
    if (outcome.kind === "step_up_confirm") {
      throw new AuthRecoveryRequiredError(
        EMA_STEP_UP_PENDING_URL,
        outcome.challenge,
        { emaStepUpConfirm: true },
      );
    }
    if (outcome.kind === "interactive") {
      throw new AuthRecoveryRequiredError(
        outcome.authorizationUrl,
        outcome.challenge,
      );
    }
    throw outcome.error;
  }

  async start(): Promise<void> {
    if (this._sessionId && !this.closed) {
      return;
    }
    return this.startWithRecovery(0);
  }

  private async startWithRecovery(retryCount: number): Promise<void> {
    /* v8 ignore next -- the sessionId getter is hardcoded to return undefined (see its doc comment), so this guard is never taken; it exists to satisfy the Transport contract. */
    if (this.sessionId) return;
    if (this.closed) throw new Error("Transport is closed");

    let authState: RemoteAuthState | undefined;
    if (this.options.authProvider) {
      const tokens = await this.options.authProvider.tokens();
      if (tokens) {
        authState = oauthTokensToRemoteAuthState(tokens);
      }
    }

    const body: RemoteConnectRequest = {
      config: this.config,
      ...(authState && { authState }),
      ...(this.options.settings && { settings: this.options.settings }),
    };

    const res = await this.fetchFn(`${this.baseUrl}/api/mcp/connect`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      const error = new Error(`Remote connect failed (${res.status}): ${text}`);
      (error as { status?: number }).status = res.status;
      throw error;
    }

    const json = (await res.json()) as RemoteConnectResponse;

    if (isConnectAuthChallenge(json)) {
      if (retryCount >= 1) {
        throw new AuthChallengeError(
          json.authChallenge,
          json.authChallenge.raw?.httpStatus ?? 401,
        );
      }
      await this.recoverFromAuthChallenge(json.authChallenge, () =>
        this.startWithRecovery(retryCount + 1),
      );
      return;
    }

    if (isConnectTransportError(json)) {
      throw new Error(`Remote connect failed: ${json.error}`);
    }

    const sessionId = legacySessionId(json);
    if (!sessionId) {
      throw new Error("Remote did not return sessionId");
    }

    this._sessionId = sessionId;
    await this.openEventStream();
  }

  private async openEventStream(): Promise<void> {
    this.eventStreamAbort = new AbortController();
    const eventRes = await this.fetchFn(
      `${this.baseUrl}/api/mcp/events?sessionId=${encodeURIComponent(this._sessionId!)}`,
      {
        headers: this.options.authToken
          ? { "x-mcp-remote-auth": `Bearer ${this.options.authToken}` }
          : {},
        signal: this.eventStreamAbort.signal,
      },
    );

    if (!eventRes.ok) {
      this._sessionId = undefined;
      throw new Error(
        `Remote events stream failed (${eventRes.status}): ${await eventRes.text()}`,
      );
    }

    const bodyStream = eventRes.body;
    if (!bodyStream) {
      throw new Error("Remote events stream has no body");
    }

    this.eventStreamReader = bodyStream.getReader();
    this.eventStreamConsumeTask = this.consumeEventStream();
  }

  /** Stop the SSE consumer and release the reader before opening a new stream. */
  private async stopEventStream(): Promise<void> {
    this.restartingEventStream = true;
    try {
      this.eventStreamAbort?.abort();
      const reader = this.eventStreamReader;
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancel errors during close
        }
      }
      this.eventStreamReader = null;
      if (this.eventStreamConsumeTask) {
        await this.eventStreamConsumeTask;
        this.eventStreamConsumeTask = null;
      }
    } finally {
      this.restartingEventStream = false;
    }
  }

  private async consumeEventStream(): Promise<void> {
    /* v8 ignore next -- consumeEventStream is only called at the end of start(), immediately after eventStreamReader is assigned from getReader(), so it is always set here. */
    if (!this.eventStreamReader) return;

    try {
      for await (const { data } of parseSSE(this.eventStreamReader)) {
        if (this.closed) break;

        try {
          const parsed = JSON.parse(data) as RemoteEvent;

          if (parsed.type === "message") {
            const msg = parsed.data as JSONRPCMessage;
            this.settleSseResponseWait(msg);
            // Keep the SSE wait alive while progress flows for a long call
            // (#2028) — the settle above never matches a notification, so this
            // is the only place a progress note touches the wait.
            const progressToken = progressTokenOf(msg);
            if (progressToken !== undefined) {
              this.resetSseResponseWait(progressToken);
            }
            this.onmessage?.(msg, undefined);
          } else if (parsed.type === "fetch_request") {
            const entry = parsed.data;
            // Stream bookkeeping runs whether or not the consumer logs
            // requests: `onFetchStreamUpdate` is documented to work on its
            // own, and `close()` needs to know which streams are open. It
            // exists only to serve that callback, though — without one the
            // set would only ever grow, one entry per reconnect.
            if (
              this.options.onFetchStreamUpdate &&
              isLongLivedStreamResponse(
                entry.method,
                findHeader(entry.responseHeaders, "content-type"),
              )
            ) {
              this.openStreams.set(entry.id, 0);
            }
            this.options.onFetchRequest?.({
              ...entry,
              timestamp:
                typeof entry.timestamp === "string"
                  ? new Date(entry.timestamp)
                  : entry.timestamp,
            });
          } else if (
            parsed.type === "fetch_request_body_update" &&
            this.options.onFetchResponseBody
          ) {
            this.options.onFetchResponseBody(
              parsed.data.id,
              parsed.data.responseBody,
            );
          } else if (
            parsed.type === "fetch_stream_update" &&
            this.options.onFetchStreamUpdate
          ) {
            const { id, eventCount, closedAt } = parsed.data;
            if (closedAt !== undefined) this.openStreams.delete(id);
            else if (this.openStreams.has(id)) {
              this.openStreams.set(id, eventCount);
            }
            this.options.onFetchStreamUpdate(id, {
              eventCount,
              ...(closedAt !== undefined && { closedAt: new Date(closedAt) }),
            });
          } else if (parsed.type === "stdio_log" && this.options.onStderr) {
            this.options.onStderr({
              timestamp: new Date(parsed.data.timestamp),
              message: parsed.data.message,
            });
          } else if (parsed.type === "auth_challenge") {
            this.options.onAuthChallenge?.(parsed.data);
          } else if (parsed.type === "transport_error") {
            const error = new Error(parsed.data.error);
            if (parsed.data.code !== undefined) {
              (error as { code?: number | string }).code = parsed.data.code;
            }
            if (!this.restartingEventStream) {
              this.onerror?.(error);
              if (!this.closed) {
                this.closed = true;
                this.onclose?.();
              }
            }
          }
        } catch (err) {
          this.onerror?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    } catch (err) {
      if (!this.closed && err instanceof Error && err.name !== "AbortError") {
        this.onerror?.(err);
      }
    } finally {
      this.eventStreamReader = null;
      if (!this.closed && !this.restartingEventStream) {
        this.closed = true;
        this.onclose?.();
      }
    }
  }

  async send(
    message: JSONRPCMessage,
    options?: TransportSendOptions,
  ): Promise<void> {
    return this.postSend(message, options, 0);
  }

  /**
   * Push auth state to the remote backend without tearing down the session.
   * Used after mid-session OAuth recovery in the web client.
   */
  async pushAuthState(authState?: RemoteAuthState): Promise<void> {
    if (!this._sessionId) {
      throw new Error("Transport not started");
    }
    if (this.closed) {
      throw new Error("Transport is closed");
    }

    const state = authState ?? (await this.buildAuthStateFromProvider());
    if (!state.oauthTokens && !state.oauthClient) {
      throw new Error("No auth state to push");
    }

    const res = await this.fetchFn(`${this.baseUrl}/api/mcp/auth-state`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ sessionId: this._sessionId, authState: state }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Remote auth-state update failed (${res.status}): ${text}`,
      );
    }

    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!json.ok) {
      throw new Error(json.error ?? "Remote auth-state update failed");
    }
  }

  private async buildAuthStateFromProvider(): Promise<RemoteAuthState> {
    if (!this.options.authProvider) {
      throw new Error("No auth provider configured");
    }
    const tokens = await this.options.authProvider.tokens();
    if (!tokens) {
      throw new Error("No OAuth tokens available");
    }
    return oauthTokensToRemoteAuthState(tokens);
  }

  private get sseResponseTimeoutMs(): number {
    return this.options.sseResponseTimeoutMs ?? DEFAULT_SSE_RESPONSE_TIMEOUT_MS;
  }

  private settleSseResponseWait(message: JSONRPCMessage): void {
    if (
      !("id" in message) ||
      message.id === null ||
      message.id === undefined ||
      (!("result" in message) && !("error" in message))
    ) {
      return;
    }
    const wait = this.sseResponseWaits.get(message.id);
    if (!wait) {
      return;
    }
    this.sseResponseWaits.delete(message.id);
    wait.resolve();
  }

  private cancelSseResponseWait(requestId: string | number): void {
    const wait = this.sseResponseWaits.get(requestId);
    if (!wait) {
      return;
    }
    this.sseResponseWaits.delete(requestId);
    wait.reject(new Error("SSE response wait cancelled"));
  }

  private cancelAllSseWaits(error: Error): void {
    for (const wait of this.sseResponseWaits.values()) {
      wait.reject(error);
    }
    this.sseResponseWaits.clear();
  }

  private waitForSseResponse(requestId: string | number): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const arm = () => {
        timer = setTimeout(() => {
          this.sseResponseWaits.delete(requestId);
          // The SDK's own per-request timeout shape, not a plain `Error`:
          // this wait can expire before the SDK's timer does (its budget is
          // the relay's, not the request's), and the rejection travels up
          // through `Client.request`, where `InspectorClient` annotates a
          // timeout of exactly this shape with the connection's state
          // (#2318). A plain error would pass that decorator untouched and
          // reach the user as a bare timeout on the web client alone.
          reject(
            new SdkError(SdkErrorCode.RequestTimeout, "Request timed out", {
              timeout: this.sseResponseTimeoutMs,
            }),
          );
        }, this.sseResponseTimeoutMs);
      };
      arm();
      this.sseResponseWaits.set(requestId, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        // A progress notification for this request re-arms the full window so
        // the browser-side deadline tracks the SDK client's progress-aware one
        // rather than firing at a flat 60s (#2028).
        resetTimeout: () => {
          clearTimeout(timer);
          arm();
        },
      });
    });
  }

  /** Re-arm a pending request's SSE wait timeout on a matching progress note. */
  private resetSseResponseWait(progressToken: string | number): void {
    waitForProgressToken(this.sseResponseWaits, progressToken)?.resetTimeout();
  }

  private async postSend(
    message: JSONRPCMessage,
    options: TransportSendOptions | undefined,
    retryCount: number,
  ): Promise<void> {
    const requestId = requestIdForMessage(message);
    let sseWait: Promise<void> | undefined;
    if (requestId !== undefined) {
      sseWait = this.waitForSseResponse(requestId);
      void sseWait.catch(() => {});
    }

    let json: RemoteSendResponse;
    try {
      json = await this.requestSend(message, options);
    } catch (error) {
      if (requestId !== undefined) {
        this.cancelSseResponseWait(requestId);
      }
      throw error;
    }

    if (json.ok) {
      if (sseWait) {
        await sseWait;
      }
      return;
    }

    if (requestId !== undefined) {
      this.cancelSseResponseWait(requestId);
    }

    if (json.kind === "auth_challenge") {
      // Send-time recovery requires pushAuthState on the existing remote session.
      // Connect-time recovery (startWithRecovery) retries with fresh authState in
      // the connect body instead — see startWithRecovery().
      if (retryCount >= 1 || !this.options.authRecovery?.pushAuthState) {
        throw new AuthChallengeError(
          json.authChallenge,
          json.authChallenge.raw?.httpStatus ?? 401,
        );
      }

      await this.recoverFromAuthChallenge(json.authChallenge, async () => {
        await this.options.authRecovery!.pushAuthState!();
        return this.postSend(message, options, retryCount + 1);
      });
      return;
    }

    throw new Error(json.error);
  }

  private async requestSend(
    message: JSONRPCMessage,
    options?: TransportSendOptions,
  ): Promise<RemoteSendResponse> {
    if (!this._sessionId) {
      throw new Error("Transport not started");
    }
    if (this.closed) {
      throw new Error("Transport is closed");
    }

    const body = {
      sessionId: this._sessionId,
      message,
      ...(options?.relatedRequestId != null && {
        relatedRequestId: options.relatedRequestId,
      }),
      // Forward per-send `Mcp-Param-*` headers (SEP-2243) for the backend to
      // apply to the upstream send; the browser can't set them cross-origin.
      ...(options?.headers != null && { headers: options.headers }),
      // Forward the negotiated protocol version so the backend's transport can
      // stamp `Mcp-Protocol-Version` on this and every later request (#1935).
      ...(this._protocolVersion !== undefined && {
        protocolVersion: this._protocolVersion,
      }),
    };

    // #2140: aborting this fetch is the cancellation signal for a
    // per-request-stream upstream. The backend holds `/api/mcp/send` open for
    // the whole call (it awaits the JSON-RPC response), so the disconnect
    // reaches it mid-flight and it aborts the upstream request's SSE stream.
    // For stdio/SSE `hasPerRequestStream` is false, so the SDK never supplies
    // a `requestSignal` and this is undefined.
    const res = await this.fetchFn(`${this.baseUrl}/api/mcp/send`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      ...(options?.requestSignal && { signal: options.requestSignal }),
    });

    if (!res.ok) {
      const text = await res.text();
      const error = new Error(`Remote send failed (${res.status}): ${text}`);
      (error as { status?: number }).status = res.status;
      throw error;
    }

    return (await res.json()) as RemoteSendResponse;
  }

  async close(): Promise<void> {
    if (this.closed) return;

    this.closed = true;
    this.cancelAllSseWaits(new Error("Transport closed"));
    await this.stopEventStream();
    // The disconnect below ends every stream the backend still holds open,
    // and its close reports cannot reach us any more (see `openStreams`).
    const closedAt = new Date();
    for (const [id, eventCount] of this.openStreams) {
      this.options.onFetchStreamUpdate?.(id, { eventCount, closedAt });
    }
    this.openStreams.clear();

    if (this._sessionId) {
      try {
        await this.fetchFn(`${this.baseUrl}/api/mcp/disconnect`, {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify({ sessionId: this._sessionId }),
        });
      } catch {
        // Ignore disconnect errors
      }
      this._sessionId = undefined;
    }

    this.onclose?.();
  }

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(
    message: T,
    extra?: MessageExtraInfo,
  ) => void;
}
