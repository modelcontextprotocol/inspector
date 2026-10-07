import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/client";
import type {
  JSONRPCMessage,
  MessageExtraInfo,
} from "@modelcontextprotocol/client";
import type {
  JSONRPCRequest,
  JSONRPCNotification,
  JSONRPCResultResponse,
  JSONRPCErrorResponse,
} from "@modelcontextprotocol/client";
import type { MessageOrigin } from "./types.js";

export interface MessageTrackingCallbacks {
  trackRequest?: (message: JSONRPCRequest, origin: MessageOrigin) => void;
  trackResponse?: (
    message: JSONRPCResultResponse | JSONRPCErrorResponse,
    origin: MessageOrigin,
  ) => void;
  trackNotification?: (
    message: JSONRPCNotification,
    origin: MessageOrigin,
  ) => void;
  /**
   * An outgoing request the base transport failed to send (the connection
   * closed, the fetch failed before the frame reached the wire). Fires after
   * `trackRequest` already recorded it, so a consumer keeping "requests still
   * awaiting a response" can roll that entry back — a request that never went
   * out is not unanswered (#2318). Not fired when the caller aborted the
   * request through `requestSignal` *during* the send: the modern transport
   * aborts an in-flight request's own stream to cancel it (and the SDK does
   * the same on a per-request timeout), and a request that was sent and then
   * given up on is exactly the unanswered kind. A signal already aborted
   * before the send began is a failed send like any other.
   */
  trackSendFailure?: (message: JSONRPCRequest, error: unknown) => void;
}

/** Narrow raw-channel surface used to consume below-SDK responses. */
export interface IncomingRawRequestChannel {
  consume(message: JSONRPCResultResponse | JSONRPCErrorResponse): boolean;
}

export interface MessageTrackingHooks {
  rawRequestChannel?: IncomingRawRequestChannel;
}

// Transport wrapper that intercepts all messages for tracking
export class MessageTrackingTransport implements Transport {
  private baseTransport: Transport;
  private callbacks: MessageTrackingCallbacks;
  private negotiatedProtocolVersion?: string;
  private hooks: MessageTrackingHooks;

  constructor(
    baseTransport: Transport,
    callbacks: MessageTrackingCallbacks,
    hooks: MessageTrackingHooks = {},
  ) {
    this.baseTransport = baseTransport;
    this.callbacks = callbacks;
    this.hooks = hooks;
  }

  async start(): Promise<void> {
    return this.baseTransport.start();
  }

  async send(
    message: JSONRPCMessage,
    options?: TransportSendOptions,
  ): Promise<void> {
    // Track outgoing traffic symmetrically to onmessage. The client issues
    // requests (client→server), answers server→client requests — roots/list,
    // sampling, elicitation (responses, which messageLogState folds back into
    // the originating request by id) — and emits its own notifications
    // (initialized, progress, roots/list_changed). All are tagged origin
    // "client".
    if ("id" in message && message.id !== null && message.id !== undefined) {
      if ("result" in message || "error" in message) {
        this.callbacks.trackResponse?.(
          message as JSONRPCResultResponse | JSONRPCErrorResponse,
          "client",
        );
      } else if ("method" in message) {
        const request = message as JSONRPCRequest;
        this.callbacks.trackRequest?.(request, "client");
        // A signal already aborted here means the frame will not go out at
        // all — that is a failed send. One that becomes aborted while the
        // send is in flight is a cancellation of a request that may well
        // have reached the server, which stays unanswered.
        const abortedBeforeSend = options?.requestSignal?.aborted === true;
        return this.baseTransport.send(message, options).catch((err) => {
          if (abortedBeforeSend || !options?.requestSignal?.aborted) {
            this.callbacks.trackSendFailure?.(request, err);
          }
          throw err;
        });
      }
    } else if ("method" in message) {
      this.callbacks.trackNotification?.(
        message as JSONRPCNotification,
        "client",
      );
    }
    return this.baseTransport.send(message, options);
  }

  async close(): Promise<void> {
    return this.baseTransport.close();
  }

  get onclose(): (() => void) | undefined {
    return this.baseTransport.onclose;
  }

  set onclose(handler: (() => void) | undefined) {
    this.baseTransport.onclose = handler;
  }

  get onerror(): ((error: Error) => void) | undefined {
    return this.baseTransport.onerror;
  }

  set onerror(handler: ((error: Error) => void) | undefined) {
    this.baseTransport.onerror = handler;
  }

  get onmessage():
    | (<T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void)
    | undefined {
    return this.baseTransport.onmessage;
  }

  set onmessage(
    handler:
      | (<T extends JSONRPCMessage>(
          message: T,
          extra?: MessageExtraInfo,
        ) => void)
      | undefined,
  ) {
    if (handler) {
      // Wrap the handler to track incoming messages
      this.baseTransport.onmessage = <T extends JSONRPCMessage>(
        message: T,
        extra?: MessageExtraInfo,
      ) => {
        // Track incoming messages
        if (
          "id" in message &&
          message.id !== null &&
          message.id !== undefined
        ) {
          // Check if it's a response (has 'result' or 'error' property)
          if ("result" in message || "error" in message) {
            this.callbacks.trackResponse?.(
              message as JSONRPCResultResponse | JSONRPCErrorResponse,
              "server",
            );
            // Consume a response to a raw-wire request the SDK never sent (e.g.
            // a modern `tasks/get`); handled entirely by the caller, not the SDK.
            if (
              this.hooks.rawRequestChannel?.consume(
                message as JSONRPCResultResponse | JSONRPCErrorResponse,
              )
            ) {
              return;
            }
          } else if ("method" in message) {
            // This is a request coming from the server
            this.callbacks.trackRequest?.(message as JSONRPCRequest, "server");
          }
        } else if ("method" in message) {
          // Notification (no ID, has method)
          this.callbacks.trackNotification?.(
            message as JSONRPCNotification,
            "server",
          );
        }
        // Call the original handler
        handler(message, extra);
      };
    } else {
      this.baseTransport.onmessage = undefined;
    }
  }

  get sessionId(): string | undefined {
    return this.baseTransport.sessionId;
  }

  /**
   * Forward the base transport's per-request-stream capability (#2140).
   *
   * The SDK's `Protocol.request` reads this off the transport it was handed —
   * which is always this wrapper — to decide how a cancelled request is
   * signalled: abort that request's own stream (the 2026-07-28 signal for
   * Streamable HTTP) or POST a `notifications/cancelled` (the stdio one).
   *
   * Not forwarding it made the wrapper *answer* the question, `undefined`, for
   * every client. So the Cancel button POSTed a notification even on a modern
   * Streamable HTTP connection, where a spec-compliant server acknowledges it
   * `202` and drops it — the tool kept running and only a disconnect really
   * cancelled anything. That hit the CLI and TUI as much as the web client:
   * their real `StreamableHTTPClientTransport` advertises the flag correctly
   * and this wrapper hid it.
   *
   * A base transport that says nothing stays `undefined` rather than becoming
   * `false`, since the SDK's check is `=== true` either way and inventing a
   * value here would misreport what the transport claimed.
   */
  get hasPerRequestStream(): boolean | undefined {
    return this.baseTransport.hasPerRequestStream;
  }

  // Implemented as a concrete method (rather than delegating the base
  // transport's optional `setProtocolVersion`) so the SDK Client always
  // invokes it after the initialize handshake — including for stdio, whose
  // base transport has no `setProtocolVersion`. We capture the negotiated
  // version for the UI here, then forward to the base transport when it
  // cares (HTTP transports stamp it into subsequent request headers).
  setProtocolVersion(version: string): void {
    this.negotiatedProtocolVersion = version;
    this.baseTransport.setProtocolVersion?.(version);
  }

  /** MCP protocol version negotiated during initialize, once connected. */
  get protocolVersion(): string | undefined {
    return this.negotiatedProtocolVersion;
  }
}
