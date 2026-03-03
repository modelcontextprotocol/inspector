/**
 * ManagedResourcesState tests use a real InspectorClient and test server (same model
 * as managedToolsState.test.ts) so we exercise actual client/server behavior.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { InspectorClient } from "../../../mcp/inspectorClient.js";
import { createTransportNode } from "../../../mcp/node/transport.js";
import { ManagedResourcesState } from "../../../mcp/state/managedResourcesState.js";
import {
  createTestServerHttp,
  createTestServerInfo,
  createArchitectureResource,
  createNumberedResources,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";

describe("ManagedResourcesState", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;
  let state: ManagedResourcesState | null = null;

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

  function waitForResourcesChange(
    s: ManagedResourcesState,
  ): Promise<Resource[]> {
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
    state = new ManagedResourcesState(client);
    expect(state.getResources()).toEqual([]);
  });

  it("on connect loads initial resources and dispatches resourcesChange", async () => {
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
    state = new ManagedResourcesState(client);
    const resourcesPromise = waitForResourcesChange(state);
    await client.connect();
    const resources = await resourcesPromise;
    expect(resources.length).toBeGreaterThan(0);
    expect(state.getResources()).toEqual(resources);
  });

  it("refresh fetches all pages and dispatches resourcesChange", async () => {
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
    state = new ManagedResourcesState(client);
    const resourcesPromise = waitForResourcesChange(state);
    const resources = await state.refresh();
    await resourcesPromise;
    expect(resources).toHaveLength(6);
    expect(state.getResources()).toEqual(resources);
  });

  it("on resourcesListChanged refreshes and updates resources", async () => {
    const { createAddResourceTool } =
      await import("@modelcontextprotocol/inspector-test-server");
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resources: [createArchitectureResource()],
      tools: [createAddResourceTool()],
      listChanged: { resources: true },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    state = new ManagedResourcesState(client);
    await client.connect();
    await waitForResourcesChange(state!);
    const listResult = await client!.listTools();
    const addResourceTool = listResult.tools.find(
      (t) => t.name === "add_resource",
    );
    expect(addResourceTool).toBeDefined();
    const resourcesChangePromise = waitForResourcesChange(state!);
    await client!.callTool(addResourceTool!, {
      uri: "test://new-resource",
      name: "newResource",
      text: "New resource content",
    });
    await resourcesChangePromise;
    expect(
      state!.getResources().some((r) => r.uri === "test://new-resource"),
    ).toBe(true);
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
    state = new ManagedResourcesState(client);
    await client.connect();
    await waitForResourcesChange(state!);
    expect(state!.getResources().length).toBeGreaterThan(0);
    await client!.disconnect();
    expect(state!.getResources()).toEqual([]);
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
    state = new ManagedResourcesState(client);
    await state.refresh();
    expect(state.getResources().length).toBeGreaterThan(0);
    state.destroy();
    expect(state.getResources()).toEqual([]);
  });
});
