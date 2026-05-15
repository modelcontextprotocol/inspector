import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  JSONRPCMessage,
  MessageExtraInfo,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  JSONRPCRequest,
  JSONRPCNotification,
  JSONRPCResultResponse,
  JSONRPCErrorResponse,
} from "@modelcontextprotocol/sdk/types.js";

export interface MessageTrackingCallbacks {
  trackRequest?: (message: JSONRPCRequest) => void;
  trackResponse?: (
    message: JSONRPCResultResponse | JSONRPCErrorResponse,
  ) => void;
  trackNotification?: (message: JSONRPCNotification) => void;
}

// Transport wrapper that intercepts all messages for tracking
export class MessageTrackingTransport implements Transport {
  constructor(
    private baseTransport: Transport,
    private callbacks: MessageTrackingCallbacks,
  ) {}

  async start(): Promise<void> {
    return this.baseTransport.start();
  }

  async send(
    message: JSONRPCMessage,
    options?: TransportSendOptions,
  ): Promise<void> {
    // Track outgoing requests (only requests have a method and are sent by the client)
    if ("method" in message && "id" in message) {
      this.callbacks.trackRequest?.(message as JSONRPCRequest);
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
            );
          } else if ("method" in message) {
            // This is a request coming from the server
            this.callbacks.trackRequest?.(message as JSONRPCRequest);
          }
        } else if ("method" in message) {
          // Notification (no ID, has method)
          this.callbacks.trackNotification?.(message as JSONRPCNotification);
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

  get setProtocolVersion(): ((version: string) => void) | undefined {
    return this.baseTransport.setProtocolVersion;
  }
}
