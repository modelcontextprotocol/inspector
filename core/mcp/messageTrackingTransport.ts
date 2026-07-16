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

// Transport wrapper that intercepts all messages for tracking
export class MessageTrackingTransport implements Transport {
  private baseTransport: Transport;
  private callbacks: MessageTrackingCallbacks;
  private negotiatedProtocolVersion?: string;

  constructor(baseTransport: Transport, callbacks: MessageTrackingCallbacks) {
    this.baseTransport = baseTransport;
    this.callbacks = callbacks;
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
