/**
 * PagedToolsState tests use a real InspectorClient and test server (same model
 * as managedToolsState.test.ts) so we exercise actual client/server behavior.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { InspectorClient } from "../../../mcp/inspectorClient.js";
import { createTransportNode } from "../../../mcp/node/transport.js";
import { PagedToolsState } from "../../../mcp/state/pagedToolsState.js";
import {
  createTestServerHttp,
  createTestServerInfo,
  createEchoTool,
  createNumberedTools,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";

describe("PagedToolsState", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;
  let state: PagedToolsState | null = null;

  afterEach(async () => {
    if (state) {
      state.destroy();
      state = null;
    }
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // ignore
      }
      client = null;
    }
    if (server) {
      try {
        await server.stop();
      } catch {
        // ignore
      }
      server = null;
    }
  });

  function waitForToolsChange(s: PagedToolsState): Promise<Tool[]> {
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
    state = new PagedToolsState(client);
    expect(state.getTools()).toEqual([]);
  });

  it("does not load tools on connect", async () => {
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
    state = new PagedToolsState(client);
    await client.connect();
    // No waitForToolsChange — we expect no toolsChange on connect
    expect(state!.getTools()).toEqual([]);
  });

  it("loadPage(undefined) loads first page and returns nextCursor when server has more", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: createNumberedTools(6),
      maxPageSize: { tools: 2 },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    await client.connect();
    state = new PagedToolsState(client);

    const toolsPromise = waitForToolsChange(state);
    const result = await state.loadPage();
    await toolsPromise;

    expect(result.tools).toHaveLength(2);
    expect(result.nextCursor).toBeDefined();
    expect(state.getTools()).toHaveLength(2);
    expect(state.getTools().map((t) => t.name)).toEqual(["tool_1", "tool_2"]);
  });

  it("loadPage(cursor) loads next page and appends to aggregated list", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: createNumberedTools(6),
      maxPageSize: { tools: 2 },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      { environment: { transport: createTransportNode } },
    );
    await client.connect();
    state = new PagedToolsState(client);

    let result = await state.loadPage();
    expect(state.getTools().length).toBeGreaterThanOrEqual(1);

    while (result.nextCursor) {
      result = await state.loadPage(result.nextCursor);
    }
    expect(state.getTools()).toHaveLength(6);
    expect(state.getTools().map((t) => t.name)).toEqual([
      "tool_1",
      "tool_2",
      "tool_3",
      "tool_4",
      "tool_5",
      "tool_6",
    ]);
  });

  it("on disconnect clears tools", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      { environment: { transport: createTransportNode } },
    );
    state = new PagedToolsState(client);
    await client.connect();
    await state.loadPage();
    expect(state.getTools().length).toBeGreaterThan(0);
    await client!.disconnect();
    expect(state!.getTools()).toEqual([]);
  });

  it("clear empties the list and dispatches toolsChange", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      { environment: { transport: createTransportNode } },
    );
    await client.connect();
    state = new PagedToolsState(client);
    await state.loadPage();
    expect(state.getTools().length).toBeGreaterThan(0);

    const toolsPromise = waitForToolsChange(state);
    state.clear();
    const tools = await toolsPromise;
    expect(tools).toEqual([]);
    expect(state.getTools()).toEqual([]);
  });

  it("after clear, loadPage(undefined) reloads from first page", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: createNumberedTools(4),
      maxPageSize: { tools: 2 },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      { environment: { transport: createTransportNode } },
    );
    await client.connect();
    state = new PagedToolsState(client);
    await state.loadPage();
    expect(state.getTools()).toHaveLength(2);
    state.clear();
    expect(state.getTools()).toEqual([]);
    await state.loadPage();
    expect(state.getTools()).toHaveLength(2);
    expect(state.getTools().map((t) => t.name)).toEqual(["tool_1", "tool_2"]);
  });

  it("destroy unsubscribes and clears state", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      { environment: { transport: createTransportNode } },
    );
    await client.connect();
    state = new PagedToolsState(client);
    await state.loadPage();
    expect(state.getTools().length).toBeGreaterThan(0);
    state.destroy();
    expect(state.getTools()).toEqual([]);
  });
});
