import { useState, useRef, useCallback } from "react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MCPServerConfig } from "../types.js";
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

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface ServerConnection {
  name: string;
  config: MCPServerConfig;
  client: Client | null;
  status: ConnectionStatus;
  error: string | null;
}

export interface MessageTrackingCallbacks {
  trackRequest?: (message: JSONRPCRequest) => void;
  trackResponse?: (
    message: JSONRPCResultResponse | JSONRPCErrorResponse,
  ) => void;
  trackNotification?: (message: JSONRPCNotification) => void;
}

// Proxy Transport that intercepts all messages for logging/tracking
class LoggingProxyTransport implements Transport {
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

// Export LoggingProxyTransport for use in other hooks
export { LoggingProxyTransport };

export function useMCPClient(
  serverName: string | null,
  config: MCPServerConfig | null,
  messageTracking?: MessageTrackingCallbacks,
) {
  const [connection, setConnection] = useState<ServerConnection | null>(null);
  const clientRef = useRef<Client | null>(null);
  const messageTrackingRef = useRef(messageTracking);
  const isMountedRef = useRef(true);

  // Update ref when messageTracking changes
  if (messageTracking) {
    messageTrackingRef.current = messageTracking;
  }

  const connect = useCallback(async (): Promise<Client | null> => {
    if (!serverName || !config) {
      return null;
    }

    // If already connected, return existing client
    if (clientRef.current && connection?.status === "connected") {
      return clientRef.current;
    }

    setConnection({
      name: serverName,
      config,
      client: null,
      status: "connecting",
      error: null,
    });

    try {
      // Only support stdio in useMCPClient hook (legacy support)
      // For full transport support, use the transport creation in App.tsx
      if (
        "type" in config &&
        config.type !== "stdio" &&
        config.type !== undefined
      ) {
        throw new Error(
          `Transport type ${config.type} not supported in useMCPClient hook`,
        );
      }
      const stdioConfig = config as any;
      const baseTransport = new StdioClientTransport({
        command: stdioConfig.command,
        args: stdioConfig.args || [],
        env: stdioConfig.env,
      });

      // Wrap with proxy transport if message tracking is enabled
      const transport = messageTrackingRef.current
        ? new LoggingProxyTransport(baseTransport, messageTrackingRef.current)
        : baseTransport;

      const client = new Client(
        {
          name: "mcp-inspect",
          version: "1.0.0",
        },
        {
          capabilities: {},
        },
      );

      await client.connect(transport);

      if (!isMountedRef.current) {
        await client.close();
        return null;
      }

      clientRef.current = client;
      setConnection({
        name: serverName,
        config,
        client,
        status: "connected",
        error: null,
      });

      return client;
    } catch (error) {
      if (!isMountedRef.current) return null;

      setConnection({
        name: serverName,
        config,
        client: null,
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }, [serverName, config, connection?.status]);

  const disconnect = useCallback(async () => {
    if (clientRef.current) {
      try {
        await clientRef.current.close();
      } catch (error) {
        // Ignore errors on close
      }
      clientRef.current = null;
    }

    if (serverName && config) {
      setConnection({
        name: serverName,
        config,
        client: null,
        status: "disconnected",
        error: null,
      });
    } else {
      setConnection(null);
    }
  }, [serverName, config]);

  return {
    connection,
    connect,
    disconnect,
  };
}
