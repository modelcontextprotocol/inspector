import { describe, it, expect, beforeEach } from "vitest";
import type { Prompt } from "@modelcontextprotocol/client";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { PagedPromptsState } from "@inspector/core/mcp/state/pagedPromptsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function prompt(name: string): Prompt {
  return { name };
}

const SINGLE_PAGE_SETTINGS: InspectorServerSettings = {
  headers: [],
  env: [],
  metadata: [],
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  roots: [],
  singlePageLists: true,
};

function waitForChange(state: PagedPromptsState): Promise<Prompt[]> {
  return new Promise((resolve) => {
    state.addEventListener("promptsChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

describe("PagedPromptsState", () => {
  let client: FakeInspectorClient;
  let state: PagedPromptsState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new PagedPromptsState(client);
  });

  it("starts empty and returns defensive copies", () => {
    expect(state.getPrompts()).toEqual([]);
    expect(state.getPrompts()).not.toBe(state.getPrompts());
  });

  it("loadPage no-ops when disconnected", async () => {
    const result = await state.loadPage();
    expect(result).toEqual({ prompts: [], nextCursor: undefined });
    expect(client.listPrompts).not.toHaveBeenCalled();
  });

  it("loadPage without cursor replaces the aggregated list", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a"), prompt("b")] });
    const changePromise = waitForChange(state);
    const result = await state.loadPage();
    expect(result.prompts.map((p) => p.name)).toEqual(["a", "b"]);
    expect(await changePromise).toEqual(result.prompts);
  });

  it("loadPage with cursor appends to the aggregated list", async () => {
    client.setStatus("connected");
    client.queuePromptPages(
      { prompts: [prompt("a")], nextCursor: "c1" },
      { prompts: [prompt("b")] },
    );
    await state.loadPage();
    await state.loadPage("c1");
    expect(state.getPrompts().map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("loadPage forwards metadata", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.loadPage(undefined, { k: "v" });
    expect(client.listPrompts).toHaveBeenCalledWith(undefined, { k: "v" });
  });

  it("clear empties the aggregated list and dispatches", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.loadPage();
    const changePromise = waitForChange(state);
    state.clear();
    expect(await changePromise).toEqual([]);
    expect(state.getPrompts()).toEqual([]);
  });

  it("statusChange to disconnected clears prompts", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.loadPage();
    const changePromise = waitForChange(state);
    client.setStatus("disconnected");
    expect(await changePromise).toEqual([]);
  });

  it("statusChange to error clears prompts (error is terminal, #1490)", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.loadPage();
    const changePromise = waitForChange(state);
    client.setStatus("error");
    expect(await changePromise).toEqual([]);
    expect(state.getPrompts()).toEqual([]);
  });

  it("statusChange to a non-terminal value (connecting) is a no-op", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.loadPage();
    client.setStatus("connecting");
    expect(state.getPrompts().map((p) => p.name)).toEqual(["a"]);
  });

  it("destroy stops listening and clears state", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.loadPage();
    state.destroy();
    expect(state.getPrompts()).toEqual([]);
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });

  describe("pagination progress + connect auto-load (#1721)", () => {
    it("tracks nextCursor/page count and dispatches paginationChange", async () => {
      client.setStatus("connected");
      client.queuePromptPages(
        { prompts: [prompt("a")], nextCursor: "c1" },
        { prompts: [prompt("b")] },
      );
      const onLoad = new Promise<{ nextCursor?: string; pageCount: number }>(
        (resolve) => {
          state.addEventListener("paginationChange", (e) => resolve(e.detail), {
            once: true,
          });
        },
      );
      await state.loadPage();
      expect(await onLoad).toEqual({ nextCursor: "c1", pageCount: 1 });
      await state.loadPage("c1");
      expect(state.getPagination()).toEqual({
        nextCursor: undefined,
        pageCount: 2,
      });
    });

    it("resets pagination on disconnect and clear", async () => {
      client.setStatus("connected");
      client.queuePromptPages({ prompts: [prompt("a")], nextCursor: "c1" });
      await state.loadPage();
      state.clear();
      expect(state.getPagination()).toEqual({
        nextCursor: undefined,
        pageCount: 0,
      });
      await state.loadPage();
      client.setStatus("disconnected");
      expect(state.getPagination()).toEqual({
        nextCursor: undefined,
        pageCount: 0,
      });
    });

    it("loads page 1 on connect in single-page mode, not otherwise", async () => {
      const spClient = new FakeInspectorClient({
        serverSettings: SINGLE_PAGE_SETTINGS,
      });
      spClient.setStatus("connected");
      const spState = new PagedPromptsState(spClient);
      spClient.queuePromptPages({ prompts: [prompt("a")] });
      const changed = waitForChange(spState);
      spClient.dispatchTypedEvent("connect");
      expect((await changed).map((p) => p.name)).toEqual(["a"]);
      spState.destroy();

      client.setStatus("connected");
      client.dispatchTypedEvent("connect");
      await Promise.resolve();
      expect(client.listPrompts).not.toHaveBeenCalled();
    });
  });
});
