import { describe, it, expect } from "vitest";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type { InspectorClientOptions } from "@inspector/core/mcp/types.js";

/**
 * `getClientInfo()` reports the identity the client sends servers (#2445).
 *
 * The web client supplies the Inspector version it read from `/api/config`;
 * without one, core falls back to a neutral `0.0.0`. These pin the getter to
 * what actually reaches the wire in `initialize`, so a test of a caller that
 * reads the getter is a test of what the server sees.
 */
class CapturingTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  sentClientInfo: unknown;

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!("method" in message) || !("id" in message)) return;
    if (message.method === "initialize") {
      const params = message.params as {
        protocolVersion: string;
        clientInfo: unknown;
      };
      this.sentClientInfo = params.clientInfo;
      this.onmessage?.({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: params.protocolVersion,
          capabilities: {},
          serverInfo: { name: "client-info-server", version: "1.0.0" },
        },
      });
    }
  }
}

function createClient(
  clientIdentity?: InspectorClientOptions["clientIdentity"],
): { client: InspectorClient; transport: CapturingTransport } {
  const transport = new CapturingTransport();
  const client = new InspectorClient(
    { type: "streamable-http", url: "https://mcp.example/mcp" },
    {
      environment: { transport: () => ({ transport }) },
      ...(clientIdentity && { clientIdentity }),
    },
  );
  return { client, transport };
}

describe("InspectorClient getClientInfo (#2445)", () => {
  it("reports and sends the caller's clientIdentity", async () => {
    const identity = { name: "mcp-inspector", version: "2.7.0" };
    const { client, transport } = createClient(identity);

    expect(client.getClientInfo()).toEqual(identity);

    await client.connect();
    try {
      expect(transport.sentClientInfo).toEqual(identity);
    } finally {
      await client.disconnect();
    }
  });

  it("falls back to the neutral 0.0.0 identity without one", async () => {
    const { client, transport } = createClient();

    expect(client.getClientInfo()).toEqual({
      name: "mcp-inspector",
      version: "0.0.0",
    });

    await client.connect();
    try {
      expect(transport.sentClientInfo).toEqual(client.getClientInfo());
    } finally {
      await client.disconnect();
    }
  });
});
