import { describe, it, expect, afterEach } from "vitest";
import * as z from "zod/v4";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { TASKS_EXTENSION_KEY } from "@inspector/core/mcp/modernTaskSchemas.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * Live coverage of advertised-extension gating (#1739). The Inspector advertises
 * a per-server `capabilities.extensions` map (Phase 1, #1738), and a server may
 * register different tools depending on what the client declared. Here a legacy
 * stateful server gates a tool on the `io.modelcontextprotocol/tasks` extension:
 * with the extension advertised the tool appears in `tools/list`; with it
 * disabled via `advertisedExtensions` the same tool is absent. Driven against a
 * real server over a real transport.
 *
 * A FRESH server is started per scenario on purpose: the gate's `oninitialized`
 * hook only enables the tool, so a server that already saw a tasks-advertising
 * client would keep it enabled for a later connection.
 */
describe("advertised-extension gating (#1739)", () => {
  const GATED_TOOL = "gated_tool";
  const ALWAYS_TOOL = "always_tool";

  let client: InspectorClient | null = null;
  const servers: TestServerHttp[] = [];

  afterEach(async () => {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
      client = null;
    }
    while (servers.length) {
      const s = servers.pop();
      try {
        await s?.stop();
      } catch {
        // ignore
      }
    }
  });

  async function startGatedServer(): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("advertised-ext-test", "1.0.0"),
      tools: [
        {
          name: ALWAYS_TOOL,
          description: "Always registered",
          inputSchema: { message: z.string().optional() },
          handler: async () => ({
            content: [{ type: "text" as const, text: "always" }],
          }),
        },
        {
          name: GATED_TOOL,
          description: "Registered only when the client declares tasks",
          inputSchema: { message: z.string().optional() },
          handler: async () => ({
            content: [{ type: "text" as const, text: "gated" }],
          }),
        },
      ],
      extensionGatedTools: { [TASKS_EXTENSION_KEY]: GATED_TOOL },
    });
    await started.start();
    servers.push(started);
    return started;
  }

  async function connect(
    url: string,
    advertisedExtensions?: Record<string, boolean>,
  ): Promise<InspectorClient> {
    const connected = new InspectorClient(
      { type: "streamable-http", url },
      {
        environment: { transport: createTransportNode },
        ...(advertisedExtensions && { advertisedExtensions }),
      },
    );
    await connected.connect();
    client = connected;
    return connected;
  }

  async function toolNames(connected: InspectorClient): Promise<string[]> {
    const { tools } = await connected.listTools();
    return tools.map((t) => t.name);
  }

  it("registers the gated tool when the client advertises the extension (default)", async () => {
    const started = await startGatedServer();
    // Default config: the Tasks extension is advertised by the registry default.
    const connected = await connect(started.url);
    const names = await toolNames(connected);
    expect(names).toContain(ALWAYS_TOOL);
    expect(names).toContain(GATED_TOOL);
  });

  it("registers the gated tool when the extension is explicitly advertised", async () => {
    const started = await startGatedServer();
    const connected = await connect(started.url, {
      [TASKS_EXTENSION_KEY]: true,
    });
    const names = await toolNames(connected);
    expect(names).toContain(GATED_TOOL);
  });

  it("omits the gated tool when the extension is not advertised", async () => {
    const started = await startGatedServer();
    // Disable the only registry extension → the client sends no extensions,
    // so the server never enables the gated tool.
    const connected = await connect(started.url, {
      [TASKS_EXTENSION_KEY]: false,
    });
    const names = await toolNames(connected);
    expect(names).toContain(ALWAYS_TOOL);
    expect(names).not.toContain(GATED_TOOL);
  });
});
