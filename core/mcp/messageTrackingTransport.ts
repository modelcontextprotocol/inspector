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
}

/**
 * Optional rewrite of an incoming response BEFORE it reaches the SDK's codec.
 * Used for extension result shapes the SDK v2 codec would reject outright — e.g.
 * a modern (SEP-2663) `resultType: "task"` result, which the codec has no
 * knowledge of (tasks were removed from the SDK). The ORIGINAL message is still
 * what `trackResponse` logs (so the Protocol/Network tabs show the true wire);
 * only the copy handed to the SDK is rewritten. Return the message unchanged to
 * pass it through untouched.
 */
export type IncomingResultRewriter = (
  message: JSONRPCResultResponse,
) => JSONRPCMessage;

/**
 * Optional consumer for an incoming response the SDK Client did not originate —
 * used for the raw-wire channel that drives extension methods the SDK v2 era
 * gate refuses to send (e.g. modern `tasks/get`/`tasks/update`/`tasks/cancel`,
 * which are spec-method names absent from the 2026-07-28 era). When this returns
 * `true` the response is treated as fully handled and is NOT forwarded to the
 * SDK Client (which has no pending request for it). The response is still logged
 * by `trackResponse` first, so the Protocol/Network tabs see the true frame.
 */
export type IncomingResponseConsumer = (
  message: JSONRPCResultResponse | JSONRPCErrorResponse,
) => boolean;

export interface MessageTrackingHooks {
  rewriteIncomingResult?: IncomingResultRewriter;
  consumeIncomingResponse?: IncomingResponseConsumer;
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
        this.callbacks.trackRequest?.(message as JSONRPCRequest, "client");
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
              this.hooks.consumeIncomingResponse?.(
                message as JSONRPCResultResponse | JSONRPCErrorResponse,
              )
            ) {
              return;
            }
            // Rewrite a result the SDK codec can't decode (e.g. a modern
            // `resultType: "task"` handle) AFTER logging the true wire, so the
            // SDK receives a shape it accepts while the Protocol/Network tabs
            // still show the real frame.
            if (this.hooks.rewriteIncomingResult && "result" in message) {
              const rewritten = this.hooks.rewriteIncomingResult(
                message as JSONRPCResultResponse,
              );
              if (rewritten !== message) {
                handler(rewritten as T, extra);
                return;
              }
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
