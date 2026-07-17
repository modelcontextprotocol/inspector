import { describe, it, expect, afterEach } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  eraToVersionNegotiation,
  MODERN_PROTOCOL_VERSION,
} from "@inspector/core/mcp/types.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createEchoTool,
} from "@modelcontextprotocol/inspector-test-server";
import type { ServerConfig } from "@modelcontextprotocol/inspector-test-server";
import type { ContentBlock } from "@modelcontextprotocol/client";

/**
 * Live coverage of the modern (2026-07-28) connection path (#1700). The bundled
 * 2025 test servers negotiate legacy only; the `modern` preset here mounts the
 * SDK's `createMcpHandler`, so an SDK v2 client negotiating
 * `protocolEra: "auto" | "modern"` reaches the modern leg end-to-end. This is
 * the live counterpart to the `auto → legacy` (stdio) test in
 * `inspectorClient.test.ts`.
 */
describe("modern-era negotiation (2026-07-28)", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      client = null;
    }
    if (server) {
      try {
        await server.stop();
      } catch {
        // Ignore server stop errors
      }
      server = null;
    }
  });

  async function startServer(
    modern: ServerConfig["modern"] = {},
  ): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("modern-era-test", "1.0.0"),
      tools: [createEchoTool()],
      modern,
    });
    await started.start();
    server = started;
    return started;
  }

  async function connectWithEra(
    url: string,
    era: "legacy" | "auto" | "modern",
  ): Promise<InspectorClient> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation(era),
      },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  it("negotiates the modern era under 'auto' with a populated discover result", async () => {
    const started = await startServer();
    const connected = await connectWithEra(started.url, "auto");

    expect(connected.getProtocolEra()).toBe("modern");
    expect(connected.getProtocolVersion()).toBe(MODERN_PROTOCOL_VERSION);

    // Unlike a legacy server, a modern server answers server/discover, so the
    // discover result is populated (supported versions + capabilities).
    const discover = connected.getDiscoverResult();
    expect(discover).toBeDefined();
    expect(discover?.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
  });

  it("negotiates the modern era under a 'modern' pin", async () => {
    const started = await startServer();
    const connected = await connectWithEra(started.url, "modern");

    expect(connected.getProtocolEra()).toBe("modern");
    expect(connected.getProtocolVersion()).toBe(MODERN_PROTOCOL_VERSION);
    expect(connected.getDiscoverResult()?.supportedVersions).toContain(
      MODERN_PROTOCOL_VERSION,
    );
  });

  it("still connects a legacy client via the stateless fallback (dual-era)", async () => {
    const started = await startServer({ legacy: "stateless" });
    const connected = await connectWithEra(started.url, "legacy");

    // A plain 2025 initialize handshake is routed to the stateless legacy leg,
    // so the client connects and reports the legacy era.
    expect(connected.getProtocolEra()).toBe("legacy");
    expect(connected.getDiscoverResult()).toBeUndefined();
    expect((await connected.listTools()).tools.length).toBeGreaterThan(0);
  });

  it("exercises the modern surface after an 'auto' connect (tools/call)", async () => {
    const started = await startServer();
    const connected = await connectWithEra(started.url, "auto");

    const { tools } = await connected.listTools();
    const echo = tools.find((t) => t.name === "echo");
    expect(echo).toBeDefined();

    const result = await connected.callTool(echo!, { message: "hi" });
    expect(result.success).toBe(true);
    const content = result.result!.content as ContentBlock[];
    expect(content[0]).toHaveProperty("type", "text");
    expect("text" in content[0] && content[0].text).toContain("hi");
  });

  it("rejects a legacy client against a strict modern-only server", async () => {
    const started = await startServer({ legacy: "reject" });
    const failing = new InspectorClient(
      { type: "streamable-http", url: started.url },
      {
        environment: { transport: createTransportNode },
        versionNegotiation: eraToVersionNegotiation("legacy"),
      },
    );
    client = failing;
    await expect(failing.connect()).rejects.toThrow();
  });
});
