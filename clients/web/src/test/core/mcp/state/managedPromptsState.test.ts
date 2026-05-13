import { describe, it, expect, beforeEach } from "vitest";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { ManagedPromptsState } from "@inspector/core/mcp/state/managedPromptsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function prompt(name: string): Prompt {
  return { name };
}

function waitForPromptsChange(state: ManagedPromptsState): Promise<Prompt[]> {
  return new Promise((resolve) => {
    state.addEventListener("promptsChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

describe("ManagedPromptsState", () => {
  let client: FakeInspectorClient;
  let state: ManagedPromptsState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new ManagedPromptsState(client);
  });

  it("starts with empty prompts", () => {
    expect(state.getPrompts()).toEqual([]);
  });

  it("getPrompts returns a defensive copy", () => {
    const a = state.getPrompts();
    const b = state.getPrompts();
    expect(a).not.toBe(b);
  });

  it("refresh returns early and does not call listPrompts when disconnected", async () => {
    const result = await state.refresh();
    expect(result).toEqual([]);
    expect(client.listPrompts).not.toHaveBeenCalled();
  });

  it("refresh fetches a single page and dispatches promptsChange", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a"), prompt("b")] });

    const changePromise = waitForPromptsChange(state);
    const result = await state.refresh();

    expect(result.map((p) => p.name)).toEqual(["a", "b"]);
    expect(await changePromise).toEqual(result);
    expect(state.getPrompts().map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("refresh accumulates across multiple paginated pages", async () => {
    client.setStatus("connected");
    client.queuePromptPages(
      { prompts: [prompt("a")], nextCursor: "c1" },
      { prompts: [prompt("b")], nextCursor: "c2" },
      { prompts: [prompt("c")] },
    );

    const result = await state.refresh();
    expect(result.map((p) => p.name)).toEqual(["a", "b", "c"]);
    expect(client.listPrompts).toHaveBeenCalledTimes(3);
  });

  it("refresh passes setMetadata-supplied metadata to listPrompts", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "v" });
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.refresh();
    expect(client.listPrompts).toHaveBeenCalledWith(undefined, { k: "v" });
  });

  it("refresh argument overrides setMetadata", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "default" });
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.refresh({ k: "override" });
    expect(client.listPrompts).toHaveBeenCalledWith(undefined, {
      k: "override",
    });
  });

  it("connect event triggers a refresh", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a")] });
    const changePromise = waitForPromptsChange(state);
    client.dispatchTypedEvent("connect");
    const next = await changePromise;
    expect(next.map((p) => p.name)).toEqual(["a"]);
  });

  it("promptsListChanged event triggers a refresh", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a"), prompt("b")] });
    const changePromise = waitForPromptsChange(state);
    client.dispatchTypedEvent("promptsListChanged");
    const next = await changePromise;
    expect(next.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("statusChange to disconnected clears prompts and dispatches promptsChange", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.refresh();
    expect(state.getPrompts()).toHaveLength(1);

    const changePromise = waitForPromptsChange(state);
    client.setStatus("disconnected");
    const next = await changePromise;
    expect(next).toEqual([]);
    expect(state.getPrompts()).toEqual([]);
  });

  it("statusChange to other (non-disconnected) values does not clear prompts", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.refresh();
    client.setStatus("error");
    expect(state.getPrompts().map((p) => p.name)).toEqual(["a"]);
  });

  it("throws when pagination exceeds 100 pages", async () => {
    client.setStatus("connected");
    client.listPrompts.mockImplementation(async () => ({
      prompts: [prompt("a")],
      nextCursor: "always",
    }));
    await expect(state.refresh()).rejects.toThrow(/Maximum pagination limit/);
  });

  it("destroy unsubscribes from client events and clears state", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.refresh();
    expect(state.getPrompts()).toHaveLength(1);

    state.destroy();
    expect(state.getPrompts()).toEqual([]);

    client.queuePromptPages({ prompts: [prompt("b")] });
    client.dispatchTypedEvent("promptsListChanged");
    await Promise.resolve();
    expect(state.getPrompts()).toEqual([]);
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
