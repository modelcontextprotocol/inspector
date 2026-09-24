import { describe, it, expect } from "vitest";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";

/**
 * `getTransportSettings()` reports the settings the open transport was built
 * from, which a live settings edit does not change (#2460).
 *
 * Custom headers are baked into the transport when it is created, while
 * `setServerSettings()` replaces the live settings on every save. A caller that
 * wants to know whether an edit is still waiting on a reconnect therefore needs
 * the transport's snapshot, not the live value, and this pins the two apart.
 */
class LegacyHandshakeTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!("method" in message) || !("id" in message)) return;
    if (message.method === "initialize") {
      const params = message.params as { protocolVersion: string };
      this.onmessage?.({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: params.protocolVersion,
          capabilities: {},
          serverInfo: { name: "settings-server", version: "1.0.0" },
        },
      });
    }
  }
}

function settingsWithHeaders(
  headers: InspectorServerSettings["headers"],
): InspectorServerSettings {
  return {
    headers,
    metadata: {},
    env: [],
    connectionTimeout: 0,
    requestTimeout: 0,
    taskTtl: 0,
    maxFetchRequests: 1000,
    roots: [],
  };
}

const CONNECT_TIME = settingsWithHeaders([
  { key: "X-Auth-Token", value: "tok" },
]);
const EDITED = settingsWithHeaders([
  { key: "X-Auth-Token", value: "tok" },
  { key: "X-Provider-Username", value: "user" },
]);

function createClient(): InspectorClient {
  return new InspectorClient(
    { type: "streamable-http", url: "https://mcp.example/mcp" },
    {
      environment: {
        transport: () => ({ transport: new LegacyHandshakeTransport() }),
      },
      serverSettings: CONNECT_TIME,
    },
  );
}

describe("InspectorClient getTransportSettings (#2460)", () => {
  it("is undefined before the first transport exists", () => {
    expect(createClient().getTransportSettings()).toBeUndefined();
  });

  it("keeps the connect-time settings across a live settings edit", async () => {
    const client = createClient();
    await client.connect();
    try {
      expect(client.getTransportSettings()).toBe(CONNECT_TIME);

      client.setServerSettings(EDITED);

      // The live value moved; the transport's did not.
      expect(client.getServerSettings()).toBe(EDITED);
      expect(client.getTransportSettings()).toBe(CONNECT_TIME);
    } finally {
      await client.disconnect();
    }
  });

  it("clears on disconnect and takes the edited settings on the next connect", async () => {
    const client = createClient();
    await client.connect();
    client.setServerSettings(EDITED);
    await client.disconnect();

    expect(client.getTransportSettings()).toBeUndefined();

    await client.connect();
    try {
      expect(client.getTransportSettings()).toBe(EDITED);
    } finally {
      await client.disconnect();
    }
  });
});
