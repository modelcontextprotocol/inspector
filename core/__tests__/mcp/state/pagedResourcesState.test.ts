/**
 * PagedResourcesState tests use a real InspectorClient and test server (same model
 * as pagedToolsState.test.ts) so we exercise actual client/server behavior.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { InspectorClient } from "../../../mcp/inspectorClient.js";
import { createTransportNode } from "../../../mcp/node/transport.js";
import { PagedResourcesState } from "../../../mcp/state/pagedResourcesState.js";
import {
  createTestServerHttp,
  createTestServerInfo,
  createArchitectureResource,
  createNumberedResources,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";

describe("PagedResourcesState", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;
  let state: PagedResourcesState | null = null;

  let unhandledRejectionHandler: (
    reason: unknown,
    promise: Promise<unknown>,
  ) => void;
  beforeEach(() => {
    unhandledRejectionHandler = (
      reason: unknown,
      promise: Promise<unknown>,
    ) => {
      const err = reason as { code?: number; message?: string };
      if (err?.code === -32000 || err?.message?.includes("Connection closed")) {
        promise.catch(() => {});
        return;
      }
      throw reason;
    };
    process.on("unhandledRejection", unhandledRejectionHandler);
  });

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
    process.off("unhandledRejection", unhandledRejectionHandler);
  });

  function waitForResourcesChange(s: PagedResourcesState): Promise<Resource[]> {
    return new Promise((resolve) => {
      s.addEventListener("resourcesChange", (e) => resolve(e.detail), {
        once: true,
      });
    });
  }

  it("starts with empty resources before connect", () => {
    client = new InspectorClient(
      { type: "streamable-http", url: "http://localhost:0" },
      { environment: { transport: createTransportNode } },
    );
    state = new PagedResourcesState(client);
    expect(state.getResources()).toEqual([]);
  });

  it("does not load resources on connect", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resources: [createArchitectureResource()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    state = new PagedResourcesState(client);
    await client.connect();
    expect(state!.getResources()).toEqual([]);
  });

  it("loadPage(undefined) loads first page and returns nextCursor when server has more", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resources: createNumberedResources(6),
      maxPageSize: { resources: 2 },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    await client.connect();
    state = new PagedResourcesState(client);

    const resourcesPromise = waitForResourcesChange(state);
    const result = await state.loadPage();
    await resourcesPromise;

    expect(result.resources).toHaveLength(2);
    expect(result.nextCursor).toBeDefined();
    expect(state.getResources()).toHaveLength(2);
  });

  it("loadPage(cursor) loads next page and appends to aggregated list", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resources: createNumberedResources(6),
      maxPageSize: { resources: 2 },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      { environment: { transport: createTransportNode } },
    );
    await client.connect();
    state = new PagedResourcesState(client);

    let result = await state.loadPage();
    expect(state.getResources().length).toBeGreaterThanOrEqual(1);

    while (result.nextCursor) {
      result = await state.loadPage(result.nextCursor);
    }
    expect(state.getResources()).toHaveLength(6);
  });

  it("on disconnect clears resources", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resources: [createArchitectureResource()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    state = new PagedResourcesState(client);
    await client.connect();
    await state.loadPage();
    expect(state.getResources().length).toBeGreaterThan(0);
    await client!.disconnect();
    expect(state!.getResources()).toEqual([]);
  });

  it("clear empties the list and dispatches resourcesChange", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resources: [createArchitectureResource()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    await client.connect();
    state = new PagedResourcesState(client);
    await state.loadPage();
    expect(state.getResources().length).toBeGreaterThan(0);

    const resourcesPromise = waitForResourcesChange(state);
    state.clear();
    const resources = await resourcesPromise;
    expect(resources).toEqual([]);
    expect(state.getResources()).toEqual([]);
  });

  it("after clear, loadPage(undefined) reloads from first page", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resources: createNumberedResources(4),
      maxPageSize: { resources: 2 },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    await client.connect();
    state = new PagedResourcesState(client);
    await state.loadPage();
    expect(state.getResources()).toHaveLength(2);
    state.clear();
    expect(state.getResources()).toEqual([]);
    await state.loadPage();
    expect(state.getResources()).toHaveLength(2);
  });

  it("destroy unsubscribes and clears state", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resources: [createArchitectureResource()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    await client.connect();
    state = new PagedResourcesState(client);
    await state.loadPage();
    expect(state.getResources().length).toBeGreaterThan(0);
    state.destroy();
    expect(state.getResources()).toEqual([]);
  });
});
