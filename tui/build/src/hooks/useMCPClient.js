import { useState, useRef, useCallback } from "react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// Proxy Transport that intercepts all messages for logging/tracking
class LoggingProxyTransport {
  baseTransport;
  callbacks;
  constructor(baseTransport, callbacks) {
    this.baseTransport = baseTransport;
    this.callbacks = callbacks;
  }
  async start() {
    return this.baseTransport.start();
  }
  async send(message, options) {
    // Track outgoing requests (only requests have a method and are sent by the client)
    if ("method" in message && "id" in message) {
      this.callbacks.trackRequest?.(message);
    }
    return this.baseTransport.send(message, options);
  }
  async close() {
    return this.baseTransport.close();
  }
  get onclose() {
    return this.baseTransport.onclose;
  }
  set onclose(handler) {
    this.baseTransport.onclose = handler;
  }
  get onerror() {
    return this.baseTransport.onerror;
  }
  set onerror(handler) {
    this.baseTransport.onerror = handler;
  }
  get onmessage() {
    return this.baseTransport.onmessage;
  }
  set onmessage(handler) {
    if (handler) {
      // Wrap the handler to track incoming messages
      this.baseTransport.onmessage = (message, extra) => {
        // Track incoming messages
        if (
          "id" in message &&
          message.id !== null &&
          message.id !== undefined
        ) {
          // Check if it's a response (has 'result' or 'error' property)
          if ("result" in message || "error" in message) {
            this.callbacks.trackResponse?.(message);
          } else if ("method" in message) {
            // This is a request coming from the server
            this.callbacks.trackRequest?.(message);
          }
        } else if ("method" in message) {
          // Notification (no ID, has method)
          this.callbacks.trackNotification?.(message);
        }
        // Call the original handler
        handler(message, extra);
      };
    } else {
      this.baseTransport.onmessage = undefined;
    }
  }
  get sessionId() {
    return this.baseTransport.sessionId;
  }
  get setProtocolVersion() {
    return this.baseTransport.setProtocolVersion;
  }
}
// Export LoggingProxyTransport for use in other hooks
export { LoggingProxyTransport };
export function useMCPClient(serverName, config, messageTracking) {
  const [connection, setConnection] = useState(null);
  const clientRef = useRef(null);
  const messageTrackingRef = useRef(messageTracking);
  const isMountedRef = useRef(true);
  // Update ref when messageTracking changes
  if (messageTracking) {
    messageTrackingRef.current = messageTracking;
  }
  const connect = useCallback(async () => {
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
      const stdioConfig = config;
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
