/**
 * Remote session - holds a transport and event queue for a remote client.
 *
 * A session outlives the browser stream that consumes it only for a bounded
 * window (#2824). Closing or reloading a tab drops `/api/mcp/events` without
 * any disconnect, and the session used to live — with its stdio child process
 * — until the Inspector exited. The backend now arms a *detach grace* timer
 * whenever no consumer is attached (see {@link RemoteSession.armDetachGrace}):
 * a consumer that reattaches inside the window (the OAuth full-page redirect's
 * `attachToSession`) cancels it, and otherwise the backend closes the transport
 * and forgets the session. While detached, events queue for that reattach, and
 * the queue is capped so a chatty server cannot grow it without bound.
 */

import type { Transport } from "@modelcontextprotocol/client";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import type { FetchRequestEntryBase, FetchStreamState } from "../../types.js";
import type { RemoteEvent } from "../types.js";
import type { AuthChallenge } from "../../../auth/challenge.js";
import { AuthChallengeError } from "../../../auth/challenge.js";
import type { RemoteAuthProviderHandle } from "./tokenAuthProvider.js";
import type { RemoteAuthState } from "../types.js";
import { progressTokenOf, waitForProgressToken } from "../progressToken.js";
import { RateLimitLedger } from "../../rateLimit.js";

export interface SessionEvent {
  type: RemoteEvent["type"];
  data: unknown;
}

type RequestWait = {
  resolve: () => void;
  reject: (error: Error) => void;
  /**
   * Re-arm this wait's timeout for another full window. Called when a
   * `notifications/progress` for this request arrives, mirroring the SDK
   * client's `resetTimeoutOnProgress` so the relay's own deadline never fires
   * before the client's progress-aware one (#2028). A no-op when the wait was
   * created without a timeout.
   */
  resetTimeout: () => void;
};

export class RemoteSession {
  /**
   * How long a session may sit with no event consumer before the backend
   * reaps it (#2824). Long enough for an OAuth full-page redirect — the one
   * flow that reattaches to a live session — to come back from the
   * authorization server; a reattach that misses it still recovers, since
   * `resumeAfterOAuth` falls back to a fresh connect. A closed or reloaded tab
   * does not wait this out: the web client sends a best-effort disconnect on
   * `pagehide`, so this window only bounds the cases where that never arrives
   * (a killed browser, a dropped network, a redirect that is never finished).
   */
  static readonly DEFAULT_DETACH_GRACE_MS = 60_000;
  /**
   * Upper bound on events held while no consumer is attached (#2824). Past it
   * the oldest event is dropped, so the newest — including a terminal
   * `transport_error` — survive, and the next consumer is told how many went.
   */
  static readonly MAX_QUEUED_EVENTS = 1_000;

  public readonly sessionId: string;
  public transport!: Transport;
  private eventQueue: SessionEvent[] = [];
  private droppedEventCount = 0;
  private detachTimer: ReturnType<typeof setTimeout> | undefined;
  private eventConsumer: ((event: SessionEvent) => void) | null = null;
  private transportDead: boolean = false;
  private transportError: string | null = null;
  private activeSendCount = 0;
  /**
   * Suppress duplicate ambient SSE auth echoes after HTTP command-scoped delivery.
   * Stale transport `onerror` may arrive after the send completes.
   */
  private authHttpEchoSuppressUntilMs = 0;
  static readonly AUTH_HTTP_ECHO_SUPPRESS_MS = 30_000;
  private readonly requestWaits = new Map<string | number, RequestWait>();
  private authProviderHandle: RemoteAuthProviderHandle | null = null;
  private appliedProtocolVersion: string | undefined;
  /** Each upstream `429`'s `Retry-After`, by the JSON-RPC id that drew it (#2442). */
  private readonly rateLimits = new RateLimitLedger();
  /** A protocol version is a dated token (`2025-11-25`, `2026-07-28`, …). */
  private static readonly PROTOCOL_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  setAuthProviderHandle(handle: RemoteAuthProviderHandle | null): void {
    this.authProviderHandle = handle;
  }

  setAuthState(authState: RemoteAuthState): void {
    if (!this.authProviderHandle) {
      throw new Error("Session has no OAuth auth provider");
    }
    this.authProviderHandle.setAuthState(authState);
  }

  setTransport(transport: Transport): void {
    this.transport = transport;
  }

  /**
   * Apply the client's negotiated protocol version to the upstream transport
   * (#1935). The browser's SDK Client owns the `initialize` handshake, so the
   * `setProtocolVersion` call it makes lands on the *remote* transport; without
   * this the backend's real HTTP transport never learns the version and drops
   * `Mcp-Protocol-Version` from every subsequent request.
   *
   * Ignores anything that isn't a plausible version token so a client can't
   * push arbitrary bytes into an upstream header, and re-applies only on
   * change (the value rides every `/api/mcp/send`). The value arrives from an
   * unvalidated JSON body, so the type is checked rather than assumed —
   * `RegExp.test` would otherwise coerce a `123` or `true` into a "matching"
   * string and hand the wrong type to the transport.
   */
  applyProtocolVersion(version: unknown): void {
    if (
      typeof version !== "string" ||
      version === this.appliedProtocolVersion ||
      !RemoteSession.PROTOCOL_VERSION_PATTERN.test(version)
    ) {
      return;
    }
    this.appliedProtocolVersion = version;
    this.transport.setProtocolVersion?.(version);
  }

  setEventConsumer(consumer: (event: SessionEvent) => void): void {
    this.cancelDetachGrace();
    this.eventConsumer = consumer;
    if (this.droppedEventCount > 0) {
      const dropped = this.droppedEventCount;
      this.droppedEventCount = 0;
      consumer({
        type: "stdio_log",
        data: {
          timestamp: new Date().toISOString(),
          message: `[inspector] ${dropped} event(s) were dropped while no client was attached (the queue holds at most ${RemoteSession.MAX_QUEUED_EVENTS})`,
        },
      });
    }
    // Flush queued events
    while (this.eventQueue.length > 0) {
      const ev = this.eventQueue.shift()!;
      consumer(ev);
    }
  }

  clearEventConsumer(): boolean {
    this.eventConsumer = null;
    // If transport is dead and no client connected, signal to cleanup
    return this.transportDead;
  }

  /**
   * Detach `consumer` only if it is still the attached one, and say whether
   * it was. An events stream that is replaced (the browser's
   * `attachToSession` stops the old stream and opens a new one) can deliver
   * its abort *after* the new stream registered, and clearing then would
   * orphan the live stream — and, since #2824, start reaping a session that
   * is in use.
   */
  detachEventConsumer(consumer: (event: SessionEvent) => void): boolean {
    if (this.eventConsumer !== consumer) {
      return false;
    }
    this.eventConsumer = null;
    return true;
  }

  /**
   * Run `onExpire` after `graceMs` unless a consumer attaches (or
   * {@link cancelDetachGrace} runs) first (#2824).
   * Re-arming replaces any pending timer. The timer is unref'd: reaping an
   * abandoned session is housekeeping, not work the process must stay alive
   * for.
   */
  armDetachGrace(graceMs: number, onExpire: () => void): void {
    this.cancelDetachGrace();
    // No consumer check at expiry: `setEventConsumer` cancels this timer, so
    // a pending one always means nobody has attached since it was armed.
    this.detachTimer = setTimeout(() => {
      this.detachTimer = undefined;
      onExpire();
    }, graceMs);
    this.detachTimer.unref();
  }

  cancelDetachGrace(): void {
    if (this.detachTimer !== undefined) {
      clearTimeout(this.detachTimer);
      this.detachTimer = undefined;
    }
  }

  hasPendingDetachGrace(): boolean {
    return this.detachTimer !== undefined;
  }

  markTransportDead(error: string): void {
    this.transportDead = true;
    this.transportError = error;
    // Always push the transport_error event — pushEvent queues it if no
    // consumer is attached yet, so a process that crashes during startup
    // (between POST /api/mcp/connect returning 200 and the browser opening
    // /api/mcp/events) still surfaces its error to the eventual consumer
    // instead of vanishing.
    this.pushEvent({
      type: "transport_error",
      data: {
        error,
        code: -32000, // MCP error code for connection closed
      },
    });
  }

  isTransportDead(): boolean {
    return this.transportDead;
  }

  getTransportError(): string | null {
    return this.transportError;
  }

  hasEventConsumer(): boolean {
    return this.eventConsumer !== null;
  }

  beginSend(): void {
    this.activeSendCount++;
  }

  endSend(): void {
    if (this.activeSendCount > 0) {
      this.activeSendCount--;
    }
  }

  /** Command-scoped auth was returned on HTTP; suppress async onerror echo on SSE. */
  noteAuthChallengeDeliveredViaHttp(): void {
    this.extendAuthHttpEchoSuppression();
  }

  private extendAuthHttpEchoSuppression(): void {
    this.authHttpEchoSuppressUntilMs =
      Date.now() + RemoteSession.AUTH_HTTP_ECHO_SUPPRESS_MS;
  }

  private shouldSuppressAuthEcho(): boolean {
    return Date.now() < this.authHttpEchoSuppressUntilMs;
  }

  hasActiveSend(): boolean {
    return this.activeSendCount > 0;
  }

  pushAuthChallenge(challenge: AuthChallenge): void {
    this.pushEvent({ type: "auth_challenge", data: challenge });
  }

  /**
   * Streamable HTTP `transport.send()` can return before the JSON-RPC response
   * arrives. The remote send handler awaits this so `/api/mcp/send` returns
   * `auth_challenge` or `ok: true` only after the MCP round-trip (or auth error).
   */
  waitForRequestResponse(
    requestId: string | number,
    timeoutMs = 60_000,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        if (timeoutMs <= 0) return;
        timer = setTimeout(() => {
          this.requestWaits.delete(requestId);
          reject(
            new Error(
              `MCP request ${String(requestId)} timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      };
      const clear = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      };
      arm();

      this.requestWaits.set(requestId, {
        resolve: () => {
          clear();
          resolve();
        },
        reject: (error) => {
          clear();
          reject(error);
        },
        // A progress notification for this request re-arms the full window, so
        // a tool that keeps reporting progress never trips the relay's own
        // deadline — the same guarantee the SDK client's `resetTimeoutOnProgress`
        // gives on a direct transport (#2028).
        resetTimeout: () => {
          if (timer === undefined) return;
          clear();
          arm();
        },
      });
    });
  }

  /**
   * Re-arm a pending request's wait timeout. Invoked from {@link onMessage} when
   * a `notifications/progress` carrying this request's `progressToken` arrives.
   * A no-op when no wait is pending for the id. A numeric string token (`"4"`)
   * matches the numeric request id, as it does in the SDK (#2458).
   */
  noteRequestProgress(progressToken: string | number): void {
    waitForProgressToken(this.requestWaits, progressToken)?.resetTimeout();
  }

  cancelRequestWait(requestId: string | number): void {
    const wait = this.requestWaits.get(requestId);
    if (!wait) {
      return;
    }
    this.requestWaits.delete(requestId);
    wait.reject(new Error("MCP request wait cancelled"));
  }

  rejectActiveRequestWaits(error: Error): void {
    for (const wait of this.requestWaits.values()) {
      wait.reject(error);
    }
    this.requestWaits.clear();
  }

  /**
   * Auth errors from the MCP transport.
   * - During an active send: command path owns delivery (HTTP); never SSE.
   * - After HTTP already returned auth_challenge: swallow async onerror echo.
   * - Otherwise: ambient SSE (idle session).
   */
  handleTransportAuthError(error: unknown): error is AuthChallengeError {
    if (!(error instanceof AuthChallengeError)) {
      return false;
    }
    this.rejectActiveRequestWaits(error);
    if (this.hasActiveSend()) {
      this.extendAuthHttpEchoSuppression();
      return true;
    }
    if (this.shouldSuppressAuthEcho()) {
      return true;
    }
    this.pushAuthChallenge(error.authChallenge);
    return true;
  }

  private settleRequestWait(requestId: string | number): void {
    const wait = this.requestWaits.get(requestId);
    if (!wait) {
      return;
    }
    this.requestWaits.delete(requestId);
    wait.resolve();
  }

  pushEvent(event: SessionEvent): void {
    if (this.eventConsumer) {
      this.eventConsumer(event);
    } else {
      if (this.eventQueue.length >= RemoteSession.MAX_QUEUED_EVENTS) {
        this.eventQueue.shift();
        this.droppedEventCount++;
      }
      this.eventQueue.push(event);
    }
  }

  onMessage(message: JSONRPCMessage): void {
    if (
      "id" in message &&
      message.id !== null &&
      message.id !== undefined &&
      ("result" in message || "error" in message)
    ) {
      this.settleRequestWait(message.id);
    }
    // A `notifications/progress` carries the originating request's id in
    // `params.progressToken` (the SDK stamps `progressToken: messageId`). Re-arm
    // that request's wait so the relay's deadline tracks the client's
    // progress-aware one instead of firing at a flat 60s (#2028). Log messages
    // (`notifications/message`) deliberately do NOT reset it, matching the SDK.
    const progressToken = progressTokenOf(message);
    if (progressToken !== undefined) {
      this.noteRequestProgress(progressToken);
    }
    this.pushEvent({ type: "message", data: message });
  }

  onFetchRequest(entry: FetchRequestEntryBase): void {
    this.rateLimits.record(entry);
    this.pushEvent({
      type: "fetch_request",
      data: {
        ...entry,
        timestamp:
          entry.timestamp instanceof Date
            ? entry.timestamp.toISOString()
            : entry.timestamp,
      },
    });
  }

  /**
   * The `Retry-After` of the upstream `429` that answered request `id` — read
   * by the send route, so the header rides back on the send's own error rather
   * than on a fetch event racing it (#2442).
   */
  takeRetryAfter(id: string | number): string | undefined {
    return this.rateLimits.take(id);
  }

  onFetchResponseBody(id: string, responseBody: string): void {
    this.pushEvent({
      type: "fetch_request_body_update",
      data: { id, responseBody },
    });
  }

  onFetchStreamUpdate(id: string, stream: FetchStreamState): void {
    this.pushEvent({
      type: "fetch_stream_update",
      data: {
        id,
        eventCount: stream.eventCount,
        ...(stream.closedAt && { closedAt: stream.closedAt.toISOString() }),
      },
    });
  }

  onStderr(entry: { timestamp: Date; message: string }): void {
    this.pushEvent({
      type: "stdio_log",
      data: {
        timestamp: entry.timestamp.toISOString(),
        message: entry.message,
      },
    });
  }
}
