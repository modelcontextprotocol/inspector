import { describe, it, expect } from "vitest";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";

/**
 * Regression coverage for #1797: a server may issue a server→client request the
 * instant it is initialized, and the Inspector must already be able to answer.
 *
 * The client advertises `roots` (and sampling/elicitation) on the SDK `Client`
 * at construction, so from the moment `connect()` sends
 * `notifications/initialized` the server is entitled to call `roots/list`.
 * `server-filesystem` does exactly that — it learns its allowed directories that
 * way — and used to get `-32601 Method not found` because the handlers were
 * registered after the handshake had already resolved.
 *
 * Driving this over a real HTTP server would make the assertion a race (the
 * outcome depends on whether the server's request lands before or after the
 * post-connect awaits). The fake transport below removes the timing entirely: it
 * delivers `roots/list` synchronously from inside the `send()` of
 * `notifications/initialized`, i.e. at the earliest instant any server could.
 */
class InitializedRacingTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;

  /** The client's reply to the injected `roots/list`, once it sends one. */
  rootsReply?: JSONRPCMessage;
  /** Id used for the injected server→client request. */
  private static readonly ROOTS_REQUEST_ID = 9001;

  async start(): Promise<void> {}
  async close(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    if (
      "method" in message &&
      message.method === "initialize" &&
      "id" in message
    ) {
      const params = message.params as { protocolVersion: string };
      this.deliver({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: params.protocolVersion,
          capabilities: {},
          serverInfo: { name: "racing-server", version: "1.0.0" },
        },
      });
      return;
    }
    if ("method" in message && message.method === "notifications/initialized") {
      // The moment the server learns we are initialized, it asks for roots.
      this.deliver({
        jsonrpc: "2.0",
        id: InitializedRacingTransport.ROOTS_REQUEST_ID,
        method: "roots/list",
      });
      return;
    }
    if (
      "id" in message &&
      message.id === InitializedRacingTransport.ROOTS_REQUEST_ID
    ) {
      this.rootsReply = message;
    }
  }

  private deliver(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }
}

describe("InspectorClient peer-request handler timing (#1797)", () => {
  it("answers a roots/list that arrives with notifications/initialized", async () => {
    const roots = [{ uri: "file:///work", name: "Work" }];
    const transport = new InitializedRacingTransport();
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      {
        environment: { transport: () => ({ transport }) },
        roots,
      },
    );

    await client.connect();

    const reply = transport.rootsReply;
    expect(reply).toBeDefined();
    expect(reply).not.toHaveProperty("error");
    expect(reply).toMatchObject({ result: { roots } });

    await client.disconnect();
  });
});
