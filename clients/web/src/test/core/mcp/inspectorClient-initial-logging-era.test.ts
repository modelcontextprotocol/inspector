import { describe, it, expect } from "vitest";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import {
  MODERN_PROTOCOL_VERSION,
  eraToVersionNegotiation,
} from "@inspector/core/mcp/types.js";

/**
 * Regression coverage for #1990: the connect-time `initialLoggingLevel` must be
 * gated on the negotiated era, not on the server capability alone.
 *
 * `logging/setLevel` is a legacy-era method, and the modern wire era rejects it
 * outright ("Method 'logging/setLevel' is not supported by the negotiated
 * protocol version"). Because the call sat in `connect()`'s post-handshake
 * sequence, that rejection failed the *connection* — so the CLI (the one caller
 * that passes `initialLoggingLevel`, hardcoded to "debug" in
 * `clients/cli/src/cli.ts`) could not run *any* method against a modern server
 * that advertised `logging`, logging-related or not.
 *
 * The two cases below are the era split: legacy still sends the request with the
 * configured level, modern connects cleanly and never puts the method on the
 * wire. The modern half asserts on the sent methods rather than on connect
 * succeeding alone — a server that happens to answer the method would hide the
 * regression behind a green connect.
 *
 * A fake transport carries both. The modern leg needs no `initialize` at all:
 * the SDK negotiates with a `server/discover` probe and adopts that result's
 * capabilities directly, which is also what lets one small class serve both eras
 * by answering whichever handshake arrives.
 */
class CapabilityAdvertisingTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  /** Every method this client put on the wire, in order. */
  readonly sentMethods: string[] = [];

  /** The params of the `logging/setLevel` request, if one was sent. */
  loggingSetLevelParams?: Record<string, unknown>;

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!("method" in message)) return;
    this.sentMethods.push(message.method);

    // The modern era's handshake: one probe, answered with the capabilities the
    // client then treats as the server's.
    if (message.method === "server/discover" && "id" in message) {
      this.reply(message.id, {
        supportedVersions: [MODERN_PROTOCOL_VERSION],
        capabilities: { logging: {} },
      });
      return;
    }

    // The legacy era's handshake.
    if (message.method === "initialize" && "id" in message) {
      const params = message.params as { protocolVersion: string };
      this.reply(message.id, {
        protocolVersion: params.protocolVersion,
        capabilities: { logging: {} },
        serverInfo: { name: "logging-server", version: "1.0.0" },
      });
      return;
    }

    if (message.method === "logging/setLevel" && "id" in message) {
      this.loggingSetLevelParams = message.params as Record<string, unknown>;
      this.reply(message.id, {});
      return;
    }
  }

  private reply(id: string | number, result: Record<string, unknown>): void {
    // The SDK resolves the request from its own microtask; delivering
    // synchronously from inside `send()` is the earliest any server could.
    this.onmessage?.({ jsonrpc: "2.0", id, result });
  }
}

async function connectWith(
  era: "legacy" | "modern",
): Promise<CapabilityAdvertisingTransport> {
  const transport = new CapabilityAdvertisingTransport();
  const client = new InspectorClient(
    { type: "streamable-http", url: "https://mcp.example/mcp" },
    {
      environment: { transport: () => ({ transport }) },
      versionNegotiation: eraToVersionNegotiation(era),
      initialLoggingLevel: "debug",
    },
  );

  await client.connect();
  expect(client.getProtocolEra()).toBe(era);
  await client.disconnect();

  return transport;
}

describe("InspectorClient connect() initial logging level, by era (#1990)", () => {
  it("sends logging/setLevel on a legacy connection", async () => {
    const transport = await connectWith("legacy");

    expect(transport.sentMethods).toContain("logging/setLevel");
    expect(transport.loggingSetLevelParams).toMatchObject({ level: "debug" });
  });

  it("never sends logging/setLevel on a modern connection", async () => {
    const transport = await connectWith("modern");

    // Modern has no session-scoped level: the equivalent is the per-request
    // `io.modelcontextprotocol/logLevel` `_meta` opt-in, driven by the
    // `modernLogLevel` server setting rather than by `initialLoggingLevel`.
    expect(transport.sentMethods).not.toContain("logging/setLevel");
    // The server did advertise logging, so the capability check alone would
    // have let the call through — the era gate is what stops it.
    expect(transport.sentMethods).toContain("server/discover");
  });
});
