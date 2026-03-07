/**
 * ManagedToolsState tests use a real InspectorClient and test server (same model
 * as inspectorClient.test.ts) so we exercise actual client/server behavior.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { InspectorClient } from "../../../mcp/inspectorClient.js";
import { createTransportNode } from "../../../mcp/node/transport.js";
import { ManagedToolsState } from "../../../mcp/state/managedToolsState.js";
import {
  createTestServerHttp,
  createTestServerInfo,
  createEchoTool,
  createNumberedTools,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";

describe("ManagedToolsState", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;
  let state: ManagedToolsState | null = null;

  afterEach(async () => {
    if (state) {
      state.destroy();
      state = null;
    }
    if (client) await client.disconnect(100);
    client = null;
    if (server) {
      try {
        await server.stop();
      } catch {
        // ignore
      }
      server = null;
    }
  });

  function waitForToolsChange(s: ManagedToolsState): Promise<Tool[]> {
    return new Promise((resolve) => {
      s.addEventListener("toolsChange", (e) => resolve(e.detail), {
        once: true,
      });
    });
  }

  it("starts with empty tools before connect", () => {
    client = new InspectorClient(
      { type: "streamable-http", url: "http://localhost:0" },
      { environment: { transport: createTransportNode } },
    );
    state = new ManagedToolsState(client);
    expect(state.getTools()).toEqual([]);
  });

  it("on connect loads initial tools and dispatches toolsChange", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    state = new ManagedToolsState(client);
    const toolsPromise = waitForToolsChange(state);
    await client.connect();
    const tools = await toolsPromise;
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((t) => t.name === "echo")).toBe(true);
    expect(state.getTools()).toEqual(tools);
  });

  it("refresh fetches all pages and dispatches toolsChange", async () => {
    // Same server config as inspectorClient.test "should accumulate tools when paginating with cursor"
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: createNumberedTools(6),
      maxPageSize: { tools: 2 },
    });
    await server.start();
    client = new InspectorClient(
      {
        type: "streamable-http",
        url: server.url,
      },
      {
        environment: { transport: createTransportNode },
        clientIdentity: { name: "test", version: "1.0.0" },
      },
    );
    await client.connect();

    // Manager refresh must see exactly 6 tools (uses listTools(), so no list interactions)
    state = new ManagedToolsState(client);
    const toolsPromise = waitForToolsChange(state);
    const tools = await state.refresh();
    await toolsPromise;
    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name)).toEqual([
      "tool_1",
      "tool_2",
      "tool_3",
      "tool_4",
      "tool_5",
      "tool_6",
    ]);
    expect(state.getTools()).toEqual(tools);
  });

  it("on toolsListChanged refreshes and updates tools", async () => {
    const { createAddToolTool } =
      await import("@modelcontextprotocol/inspector-test-server");
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool(), createAddToolTool()],
      listChanged: { tools: true },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    state = new ManagedToolsState(client);
    await client.connect();
    await waitForToolsChange(state!);
    const toolsBefore = state!.getTools();
    expect(toolsBefore.length).toBeGreaterThan(0);

    const addTool = state!.getTools().find((t) => t.name === "add_tool");
    expect(addTool).toBeDefined();
    const toolsChangePromise = waitForToolsChange(state!);
    await client!.callTool(addTool!, {
      name: "newTool",
      description: "A new test tool",
    });
    await toolsChangePromise;
    const toolsAfter = state!.getTools();
    expect(toolsAfter.find((t) => t.name === "newTool")).toBeDefined();
  });

  it("on disconnect clears tools", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    state = new ManagedToolsState(client);
    await client.connect();
    await waitForToolsChange(state!);
    expect(state!.getTools().length).toBeGreaterThan(0);
    await client!.disconnect(100);
    expect(state!.getTools()).toEqual([]);
  });

  it("destroy unsubscribes and clears state", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    await client.connect();
    state = new ManagedToolsState(client);
    await state.refresh();
    expect(state.getTools().length).toBeGreaterThan(0);
    state.destroy();
    expect(state.getTools()).toEqual([]);
  });
});
