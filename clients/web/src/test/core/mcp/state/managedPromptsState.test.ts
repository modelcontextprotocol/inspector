import { describe, it, expect, beforeEach } from "vitest";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { ManagedPromptsState } from "@inspector/core/mcp/state/managedPromptsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function prompt(name: string): Prompt {
  return { name };
}

const AUTO_REFRESH_SETTINGS: InspectorServerSettings = {
  headers: [],
  metadata: [],
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  autoRefreshOnListChanged: true,
  roots: [],
};

function waitForPromptsChange(state: ManagedPromptsState): Promise<Prompt[]> {
  return new Promise((resolve) => {
    state.addEventListener("promptsChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

function waitForListChanged(state: ManagedPromptsState): Promise<boolean> {
  return new Promise((resolve) => {
    state.addEventListener("listChangedChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

describe("ManagedPromptsState", () => {
  let client: FakeInspectorClient;
  let state: ManagedPromptsState;

  beforeEach(() => {
    // Default to a server that advertises `prompts` so the existing flow tests
    // exercise the live `listPrompts` path; capability-absent tests below
    // override this.
    client = new FakeInspectorClient({ capabilities: { prompts: {} } });
    state = new ManagedPromptsState(client, 0);
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

  it("refresh skips listPrompts when the server doesn't advertise prompts capability", async () => {
    // Regression (#1350): a prompts-less server replied to prompts/list with
    // -32601 "Method not found", surfacing in the console on every connect.
    const promptless = new FakeInspectorClient({
      capabilities: { tools: {}, resources: {} },
    });
    promptless.setStatus("connected");
    const promptlessState = new ManagedPromptsState(promptless, 0);

    const result = await promptlessState.refresh();
    expect(result).toEqual([]);
    expect(promptless.listPrompts).not.toHaveBeenCalled();
  });

  it("connect against a prompts-less server doesn't fire listPrompts", async () => {
    // The connect event runs refresh; the capability gate must also catch it
    // there, not only the publicly-callable refresh().
    const promptless = new FakeInspectorClient({ capabilities: { tools: {} } });
    promptless.setStatus("connected");
    const promptlessState = new ManagedPromptsState(promptless, 0);

    promptless.dispatchTypedEvent("connect");
    // Yield so the async refresh chained off connect runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(promptless.listPrompts).not.toHaveBeenCalled();
    expect(promptlessState.getPrompts()).toEqual([]);
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

  it("promptsListChanged peeks but does NOT replace the displayed list by default", async () => {
    // Diff-aware (#1444): the notification fetches to compare, but the
    // displayed list stays put until the user pulls via Refresh.
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a"), prompt("b")] });
    const changed = waitForListChanged(state);
    client.dispatchTypedEvent("promptsListChanged");
    expect(await changed).toBe(true); // the peeked list differs from []
    expect(client.listPrompts).toHaveBeenCalled(); // it fetched to compare
    expect(state.getPrompts()).toEqual([]); // ...but did not replace the display
  });

  it("promptsListChanged does NOT light the indicator when the list is unchanged", async () => {
    client.setStatus("connected");
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.refresh();
    expect(state.getPrompts().map((p) => p.name)).toEqual(["a"]);

    let fired = false;
    state.addEventListener("listChangedChange", () => {
      fired = true;
    });
    client.queuePromptPages({ prompts: [prompt("a")] });
    client.dispatchTypedEvent("promptsListChanged");
    await new Promise((r) => setTimeout(r, 0));
    expect(client.listPrompts).toHaveBeenCalledTimes(2); // refresh + peek
    expect(fired).toBe(false);
    expect(state.getListChanged()).toBe(false);
  });

  it("promptsListChanged auto-refreshes when the server opts in", async () => {
    const autoClient = new FakeInspectorClient({
      capabilities: { prompts: {} },
      serverSettings: AUTO_REFRESH_SETTINGS,
    });
    autoClient.setStatus("connected");
    const autoState = new ManagedPromptsState(autoClient, 0);
    autoClient.queuePromptPages({ prompts: [prompt("a")] });
    const changed = waitForPromptsChange(autoState);
    autoClient.dispatchTypedEvent("promptsListChanged");
    expect((await changed).map((p) => p.name)).toEqual(["a"]);
    expect(autoClient.listPrompts).toHaveBeenCalled();
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

  describe("listChanged (#1402)", () => {
    it("starts cleared", () => {
      expect(state.getListChanged()).toBe(false);
    });

    it("promptsListChanged sets the flag and dispatches listChangedChange", async () => {
      client.setStatus("connected");
      client.queuePromptPages({ prompts: [prompt("a")] });
      const changed = waitForListChanged(state);
      client.dispatchTypedEvent("promptsListChanged");
      expect(await changed).toBe(true);
      expect(state.getListChanged()).toBe(true);
    });

    it("clearListChanged resets the flag and dispatches false", async () => {
      client.setStatus("connected");
      client.queuePromptPages({ prompts: [prompt("a")] });
      const set = waitForListChanged(state);
      client.dispatchTypedEvent("promptsListChanged");
      await set; // wait for the async peek to set the flag
      expect(state.getListChanged()).toBe(true);

      const changed = waitForListChanged(state);
      state.clearListChanged();
      expect(await changed).toBe(false);
      expect(state.getListChanged()).toBe(false);
    });

    it("clearListChanged is a no-op (no event) when already cleared", () => {
      let fired = false;
      state.addEventListener("listChangedChange", () => {
        fired = true;
      });
      state.clearListChanged();
      expect(fired).toBe(false);
    });

    it("disconnect clears the flag", async () => {
      client.setStatus("connected");
      client.queuePromptPages({ prompts: [prompt("a")] });
      const set = waitForListChanged(state);
      client.dispatchTypedEvent("promptsListChanged");
      await set; // wait for the async peek to set the flag
      expect(state.getListChanged()).toBe(true);

      const changed = waitForListChanged(state);
      client.setStatus("disconnected");
      expect(await changed).toBe(false);
      expect(state.getListChanged()).toBe(false);
    });
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
