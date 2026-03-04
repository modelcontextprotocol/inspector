/**
 * ManagedPromptsState tests use a real InspectorClient and test server (same model
 * as managedToolsState.test.ts) so we exercise actual client/server behavior.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { InspectorClient } from "../../../mcp/inspectorClient.js";
import { createTransportNode } from "../../../mcp/node/transport.js";
import { ManagedPromptsState } from "../../../mcp/state/managedPromptsState.js";
import {
  createTestServerHttp,
  createTestServerInfo,
  createSimplePrompt,
  createNumberedPrompts,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";

describe("ManagedPromptsState", () => {
  let client: InspectorClient | null = null;
  let server: TestServerHttp | null = null;
  let state: ManagedPromptsState | null = null;

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

  function waitForPromptsChange(s: ManagedPromptsState): Promise<Prompt[]> {
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
    state = new ManagedPromptsState(client);
    expect(state.getPrompts()).toEqual([]);
  });

  it("on connect loads initial prompts and dispatches promptsChange", async () => {
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
    state = new ManagedPromptsState(client);
    const promptsPromise = waitForPromptsChange(state);
    await client.connect();
    const prompts = await promptsPromise;
    expect(prompts.length).toBeGreaterThan(0);
    expect(state.getPrompts()).toEqual(prompts);
  });

  it("refresh fetches all pages and dispatches promptsChange", async () => {
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
    state = new ManagedPromptsState(client);
    const promptsPromise = waitForPromptsChange(state);
    const prompts = await state.refresh();
    await promptsPromise;
    expect(prompts).toHaveLength(6);
    expect(state.getPrompts()).toEqual(prompts);
  });

  it("on promptsListChanged refreshes and updates prompts", async () => {
    const { createAddPromptTool } =
      await import("@modelcontextprotocol/inspector-test-server");
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      prompts: [createSimplePrompt()],
      tools: [createAddPromptTool()],
      listChanged: { prompts: true },
    });
    await server.start();
    client = new InspectorClient(
      { type: "streamable-http", url: server.url },
      {
        environment: { transport: createTransportNode },
      },
    );
    state = new ManagedPromptsState(client);
    await client.connect();
    await waitForPromptsChange(state!);
    const listResult = await client!.listTools();
    const addPromptTool = listResult.tools.find((t) => t.name === "add_prompt");
    expect(addPromptTool).toBeDefined();
    const promptsChangePromise = waitForPromptsChange(state!);
    await client!.callTool(addPromptTool!, {
      name: "newPrompt",
      promptString: "This is a new prompt",
    });
    await promptsChangePromise;
    expect(state!.getPrompts().some((p) => p.name === "newPrompt")).toBe(true);
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
    state = new ManagedPromptsState(client);
    await client.connect();
    await waitForPromptsChange(state!);
    expect(state!.getPrompts().length).toBeGreaterThan(0);
    await client!.disconnect(100);
    expect(state!.getPrompts()).toEqual([]);
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
    state = new ManagedPromptsState(client);
    await state.refresh();
    expect(state.getPrompts().length).toBeGreaterThan(0);
    state.destroy();
    expect(state.getPrompts()).toEqual([]);
  });
});
