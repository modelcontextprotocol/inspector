import { describe, it, expect, afterEach } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createEchoTool,
  createGetWeatherTool,
} from "@modelcontextprotocol/inspector-test-server";
import type { Tool } from "@modelcontextprotocol/client";

/**
 * SEP-2243 `x-mcp-header` → `Mcp-Param-*` mirroring on `tools/call` (#1846).
 *
 * The SDK only mirrors inside `client.callTool()` (and skips it in a browser
 * environment); the Inspector routes `tools/call` through `client.request()`
 * for manual MRTR driving (#1704), so it mirrors the headers itself. A strict
 * modern server (e.g. GitHub's) rejects a call whose annotated argument isn't
 * mirrored, so this must ride the wire. Here we spy on the transport `fetch` and
 * assert the `tools/call` POST carries the mirrored header with the spec's
 * value encoding.
 */
describe("x-mcp-header Mcp-Param-* mirroring on tools/call", () => {
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

  /** Records the request headers of every `tools/call` POST the client sends. */
  function makeSpyFetch(): {
    fetch: typeof fetch;
    toolCallHeaders: Headers[];
  } {
    const toolCallHeaders: Headers[] = [];
    const spy: typeof fetch = async (input, init) => {
      const body = init?.body;
      if (typeof body === "string" && body.includes('"tools/call"')) {
        try {
          const parsed = JSON.parse(body) as { method?: string };
          if (parsed.method === "tools/call") {
            toolCallHeaders.push(new Headers(init?.headers));
          }
        } catch {
          // Non-JSON body — ignore.
        }
      }
      return fetch(input, init);
    };
    return { fetch: spy, toolCallHeaders };
  }

  async function connectModern(
    url: string,
    fetchFn: typeof fetch,
  ): Promise<InspectorClient> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode, fetch: fetchFn },
        versionNegotiation: eraToVersionNegotiation("auto"),
      },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  async function startWeatherServer(): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("xmcpheader-test", "1.0.0"),
      tools: [createEchoTool(), createGetWeatherTool()],
      modern: {},
    });
    await started.start();
    server = started;
    return started;
  }

  async function weatherTool(c: InspectorClient): Promise<Tool> {
    const { tools } = await c.listTools();
    const weather = tools.find((t) => t.name === "get_weather");
    expect(weather).toBeDefined();
    return weather!;
  }

  it("mirrors an annotated argument into the Mcp-Param-* request header", async () => {
    const started = await startWeatherServer();
    const spy = makeSpyFetch();
    const connected = await connectModern(started.url, spy.fetch);
    expect(connected.getProtocolEra()).toBe("modern");

    const result = await connected.callTool(await weatherTool(connected), {
      city: "London",
    });

    expect(result.success).toBe(true);
    expect(spy.toolCallHeaders.length).toBeGreaterThan(0);
    const sent = spy.toolCallHeaders.at(-1)!;
    expect(sent.get("Mcp-Param-City")).toBe("London");
  });

  it("mirrors on the task-augmented tools/call too (callToolStream)", async () => {
    // The "Run as task" path builds its own request options, so it needs the
    // same mirroring — a strict modern server rejects the task-augmented
    // `tools/call` with -32020 when the header is missing, exactly as it does
    // the plain one.
    const started = await startWeatherServer();
    const spy = makeSpyFetch();
    const connected = await connectModern(started.url, spy.fetch);

    const result = await connected.callToolStream(
      await weatherTool(connected),
      { city: "London" },
      undefined,
      undefined,
      { ttl: 60_000 },
    );

    expect(result.success).toBe(true);
    expect(spy.toolCallHeaders.at(-1)!.get("Mcp-Param-City")).toBe("London");
  });

  it("sends no Mcp-Param-* header for a tool without annotations", async () => {
    const started = await startWeatherServer();
    const spy = makeSpyFetch();
    const connected = await connectModern(started.url, spy.fetch);

    const { tools } = await connected.listTools();
    const echo = tools.find((t) => t.name === "echo")!;
    await connected.callTool(echo, { message: "hi" });

    const sent = spy.toolCallHeaders.at(-1)!;
    let sawMcpParam = false;
    sent.forEach((_v, k) => {
      if (k.toLowerCase().startsWith("mcp-param-")) sawMcpParam = true;
    });
    expect(sawMcpParam).toBe(false);
  });

  it("does not mirror on a legacy connection", async () => {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("xmcpheader-legacy", "1.0.0"),
      tools: [createGetWeatherTool()],
      modern: { legacy: "stateless" },
    });
    await started.start();
    server = started;

    const spy = makeSpyFetch();
    const connected = new InspectorClient(
      { type: "streamable-http", url: started.url },
      {
        environment: { transport: createTransportNode, fetch: spy.fetch },
        versionNegotiation: eraToVersionNegotiation("legacy"),
      },
    );
    await connected.connect();
    client = connected;
    expect(connected.getProtocolEra()).toBe("legacy");

    await connected.callTool(await weatherTool(connected), { city: "London" });
    const sent = spy.toolCallHeaders.at(-1)!;
    expect(sent.get("Mcp-Param-City")).toBeNull();
  });
});
