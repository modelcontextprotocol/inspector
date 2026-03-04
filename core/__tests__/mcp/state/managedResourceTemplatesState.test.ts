/**
 * ManagedResourceTemplatesState tests use a real InspectorClient and test server (same model
 * as managedToolsState.test.ts) so we exercise actual client/server behavior.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { InspectorClient } from "../../../mcp/inspectorClient.js";
import { createTransportNode } from "../../../mcp/node/transport.js";
import { ManagedResourceTemplatesState } from "../../../mcp/state/managedResourceTemplatesState.js";
import {
  createTestServerHttp,
  createTestServerInfo,
  createFileResourceTemplate,
  createNumberedResourceTemplates,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";

describe("ManagedResourceTemplatesState", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;
  let state: ManagedResourceTemplatesState | null = null;

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

  function waitForResourceTemplatesChange(
    s: ManagedResourceTemplatesState,
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
    state = new ManagedResourceTemplatesState(client);
    expect(state.getResourceTemplates()).toEqual([]);
  });

  it("on connect loads initial resource templates and dispatches resourceTemplatesChange", async () => {
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
    state = new ManagedResourceTemplatesState(client);
    const templatesPromise = waitForResourceTemplatesChange(state);
    await client.connect();
    const templates = await templatesPromise;
    expect(templates.length).toBeGreaterThan(0);
    expect(state.getResourceTemplates()).toEqual(templates);
  });

  it("refresh fetches all pages and dispatches resourceTemplatesChange", async () => {
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
    state = new ManagedResourceTemplatesState(client);
    const templatesPromise = waitForResourceTemplatesChange(state);
    const templates = await state.refresh();
    await templatesPromise;
    expect(templates).toHaveLength(6);
    expect(state.getResourceTemplates()).toEqual(templates);
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
    state = new ManagedResourceTemplatesState(client);
    await client.connect();
    await waitForResourceTemplatesChange(state!);
    expect(state!.getResourceTemplates().length).toBeGreaterThan(0);
    await client!.disconnect(100);
    expect(state!.getResourceTemplates()).toEqual([]);
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
    state = new ManagedResourceTemplatesState(client);
    await state.refresh();
    expect(state.getResourceTemplates().length).toBeGreaterThan(0);
    state.destroy();
    expect(state.getResourceTemplates()).toEqual([]);
  });
});
