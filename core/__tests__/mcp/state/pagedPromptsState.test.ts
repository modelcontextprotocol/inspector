/**
 * PagedPromptsState tests use a real InspectorClient and test server (same model
 * as pagedToolsState.test.ts) so we exercise actual client/server behavior.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { InspectorClient } from "../../../mcp/inspectorClient.js";
import { createTransportNode } from "../../../mcp/node/transport.js";
import { PagedPromptsState } from "../../../mcp/state/pagedPromptsState.js";
import {
  createTestServerHttp,
  createTestServerInfo,
  createSimplePrompt,
  createNumberedPrompts,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";

describe("PagedPromptsState", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;
  let state: PagedPromptsState | null = null;

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

  function waitForPromptsChange(s: PagedPromptsState): Promise<Prompt[]> {
    return new Promise((resolve) => {
      s.addEventListener("promptsChange", (e) => resolve(e.detail), {
        once: true,
      });
    });
  }

  it("starts with empty prompts before connect", () => {
    client = new InspectorClient(
      { type: "streamable-http", url: "http://localhost:0" },
      { environment: { transport: createTransportNode } },
    );
    state = new PagedPromptsState(client);
    expect(state.getPrompts()).toEqual([]);
  });

  it("does not load prompts on connect", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      prompts: [createSimplePrompt()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    state = new PagedPromptsState(client);
    await client.connect();
    expect(state!.getPrompts()).toEqual([]);
  });

  it("loadPage(undefined) loads first page and returns nextCursor when server has more", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      prompts: createNumberedPrompts(6),
      maxPageSize: { prompts: 2 },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    await client.connect();
    state = new PagedPromptsState(client);

    const promptsPromise = waitForPromptsChange(state);
    const result = await state.loadPage();
    await promptsPromise;

    expect(result.prompts).toHaveLength(2);
    expect(result.nextCursor).toBeDefined();
    expect(state.getPrompts()).toHaveLength(2);
  });

  it("loadPage(cursor) loads next page and appends to aggregated list", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      prompts: createNumberedPrompts(6),
      maxPageSize: { prompts: 2 },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      { environment: { transport: createTransportNode } },
    );
    await client.connect();
    state = new PagedPromptsState(client);

    let result = await state.loadPage();
    expect(state.getPrompts().length).toBeGreaterThanOrEqual(1);

    while (result.nextCursor) {
      result = await state.loadPage(result.nextCursor);
    }
    expect(state.getPrompts()).toHaveLength(6);
  });

  it("on disconnect clears prompts", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      prompts: [createSimplePrompt()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    state = new PagedPromptsState(client);
    await client.connect();
    await state.loadPage();
    expect(state.getPrompts().length).toBeGreaterThan(0);
    await client!.disconnect();
    expect(state!.getPrompts()).toEqual([]);
  });

  it("clear empties the list and dispatches promptsChange", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      prompts: [createSimplePrompt()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    await client.connect();
    state = new PagedPromptsState(client);
    await state.loadPage();
    expect(state.getPrompts().length).toBeGreaterThan(0);

    const promptsPromise = waitForPromptsChange(state);
    state.clear();
    const prompts = await promptsPromise;
    expect(prompts).toEqual([]);
    expect(state.getPrompts()).toEqual([]);
  });

  it("destroy unsubscribes and clears state", async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      prompts: [createSimplePrompt()],
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    await client.connect();
    state = new PagedPromptsState(client);
    await state.loadPage();
    expect(state.getPrompts().length).toBeGreaterThan(0);
    state.destroy();
    expect(state.getPrompts()).toEqual([]);
  });
});
