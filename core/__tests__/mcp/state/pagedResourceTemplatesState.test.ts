/**
 * PagedResourceTemplatesState tests use a real InspectorClient and test server (same model
 * as pagedToolsState.test.ts) so we exercise actual client/server behavior.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { InspectorClient } from "../../../mcp/inspectorClient.js";
import { createTransportNode } from "../../../mcp/node/transport.js";
import { PagedResourceTemplatesState } from "../../../mcp/state/pagedResourceTemplatesState.js";
import {
  createTestServerHttp,
  createTestServerInfo,
  createFileResourceTemplate,
  createNumberedResourceTemplates,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";

describe("PagedResourceTemplatesState", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;
  let state: PagedResourceTemplatesState | null = null;

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
    process.off("unhandledRejection", unhandledRejectionHandler);
  });

  function waitForResourceTemplatesChange(
    s: PagedResourceTemplatesState,
  ): Promise<ResourceTemplate[]> {
    return new Promise((resolve) => {
      s.addEventListener("resourceTemplatesChange", (e) => resolve(e.detail), {
        once: true,
      });
    });
  }

  it("starts with empty resource templates before connect", () => {
    client = new InspectorClient(
      { type: "streamable-http", url: "http://localhost:0" },
      { environment: { transport: createTransportNode } },
    );
    state = new PagedResourceTemplatesState(client);
    expect(state.getResourceTemplates()).toEqual([]);
  });

  it("does not load resource templates on connect", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resourceTemplates: [createFileResourceTemplate()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    state = new PagedResourceTemplatesState(client);
    await client.connect();
    expect(state!.getResourceTemplates()).toEqual([]);
  });

  it("loadPage(undefined) loads first page and returns nextCursor when server has more", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resourceTemplates: createNumberedResourceTemplates(6),
      maxPageSize: { resourceTemplates: 2 },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    await client.connect();
    state = new PagedResourceTemplatesState(client);

    const templatesPromise = waitForResourceTemplatesChange(state);
    const result = await state.loadPage();
    await templatesPromise;

    expect(result.resourceTemplates).toHaveLength(2);
    expect(result.nextCursor).toBeDefined();
    expect(state.getResourceTemplates()).toHaveLength(2);
  });

  it("loadPage(cursor) loads next page and appends to aggregated list", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resourceTemplates: createNumberedResourceTemplates(6),
      maxPageSize: { resourceTemplates: 2 },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      { environment: { transport: createTransportNode } },
    );
    await client.connect();
    state = new PagedResourceTemplatesState(client);

    let result = await state.loadPage();
    expect(state.getResourceTemplates().length).toBeGreaterThanOrEqual(1);

    while (result.nextCursor) {
      result = await state.loadPage(result.nextCursor);
    }
    expect(state.getResourceTemplates()).toHaveLength(6);
  });

  it("on disconnect clears resource templates", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resourceTemplates: [createFileResourceTemplate()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    state = new PagedResourceTemplatesState(client);
    await client.connect();
    await state.loadPage();
    expect(state.getResourceTemplates().length).toBeGreaterThan(0);
    await client!.disconnect(100);
    expect(state!.getResourceTemplates()).toEqual([]);
  });

  it("clear empties the list and dispatches resourceTemplatesChange", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resourceTemplates: [createFileResourceTemplate()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    await client.connect();
    state = new PagedResourceTemplatesState(client);
    await state.loadPage();
    expect(state.getResourceTemplates().length).toBeGreaterThan(0);

    const templatesPromise = waitForResourceTemplatesChange(state);
    state.clear();
    const templates = await templatesPromise;
    expect(templates).toEqual([]);
    expect(state.getResourceTemplates()).toEqual([]);
  });

  it("destroy unsubscribes and clears state", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resourceTemplates: [createFileResourceTemplate()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    await client.connect();
    state = new PagedResourceTemplatesState(client);
    await state.loadPage();
    expect(state.getResourceTemplates().length).toBeGreaterThan(0);
    state.destroy();
    expect(state.getResourceTemplates()).toEqual([]);
  });
});
