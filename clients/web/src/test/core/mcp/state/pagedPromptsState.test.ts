import { describe, it, expect, beforeEach } from "vitest";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { PagedPromptsState } from "@inspector/core/mcp/state/pagedPromptsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function prompt(name: string): Prompt {
  return { name };
}

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

  it("statusChange to non-disconnected values is a no-op", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.loadPage();
    client.setStatus("error");
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
});
