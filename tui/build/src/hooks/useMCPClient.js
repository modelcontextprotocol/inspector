import { useState, useRef, useCallback } from "react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MessageTrackingTransport } from "../utils/messageTrackingTransport.js";
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
      // Wrap with message tracking transport if message tracking is enabled
      const transport = messageTrackingRef.current
        ? new MessageTrackingTransport(
            baseTransport,
            messageTrackingRef.current,
          )
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
