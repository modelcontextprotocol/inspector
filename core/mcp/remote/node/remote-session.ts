/**
 * Remote session - holds a transport and event queue for a remote client.
 */

import type { Transport } from "@modelcontextprotocol/client";
import type { JSONRPCMessage } from "@modelcontextprotocol/client";
import type { FetchRequestEntryBase } from "../../types.js";
import type { RemoteEvent } from "../types.js";
import type { AuthChallenge } from "../../../auth/challenge.js";
import { AuthChallengeError } from "../../../auth/challenge.js";
import type { RemoteAuthProviderHandle } from "./tokenAuthProvider.js";
import type { RemoteAuthState } from "../types.js";

export interface SessionEvent {
  type: RemoteEvent["type"];
  data: unknown;
}

type RequestWait = {
  resolve: () => void;
  reject: (error: Error) => void;
};

export class RemoteSession {
  public readonly sessionId: string;
  public transport!: Transport;
  private eventQueue: SessionEvent[] = [];
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

  setEventConsumer(consumer: (event: SessionEvent) => void): void {
    this.eventConsumer = consumer;
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
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.requestWaits.delete(requestId);
              reject(
                new Error(
                  `MCP request ${String(requestId)} timed out after ${timeoutMs}ms`,
                ),
              );
            }, timeoutMs)
          : undefined;

      this.requestWaits.set(requestId, {
        resolve: () => {
          if (timer !== undefined) {
            clearTimeout(timer);
          }
          resolve();
        },
        reject: (error) => {
          if (timer !== undefined) {
            clearTimeout(timer);
          }
          reject(error);
        },
      });
    });
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
    this.pushEvent({ type: "message", data: message });
  }

  onFetchRequest(entry: FetchRequestEntryBase): void {
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

  onFetchResponseBody(id: string, responseBody: string): void {
    this.pushEvent({
      type: "fetch_request_body_update",
      data: { id, responseBody },
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
