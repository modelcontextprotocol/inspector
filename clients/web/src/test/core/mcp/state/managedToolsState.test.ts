import { describe, it, expect, beforeEach } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { ManagedToolsState } from "@inspector/core/mcp/state/managedToolsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function tool(name: string): Tool {
  return { name, inputSchema: { type: "object" } };
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

function waitForToolsChange(state: ManagedToolsState): Promise<Tool[]> {
  return new Promise((resolve) => {
    state.addEventListener("toolsChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

describe("ManagedToolsState", () => {
  let client: FakeInspectorClient;
  let state: ManagedToolsState;

  beforeEach(() => {
    // Default to a server that advertises `tools` so the existing flow tests
    // exercise the live `listTools` path; capability-absent tests below
    // override this.
    client = new FakeInspectorClient({ capabilities: { tools: {} } });
    state = new ManagedToolsState(client);
  });

  it("starts with empty tools", () => {
    expect(state.getTools()).toEqual([]);
  });

  it("getTools returns a defensive copy", () => {
    const a = state.getTools();
    const b = state.getTools();
    expect(a).not.toBe(b);
  });

  it("refresh returns early and does not call listTools when disconnected", async () => {
    const result = await state.refresh();
    expect(result).toEqual([]);
    expect(client.listTools).not.toHaveBeenCalled();
  });

  it("refresh skips listTools when the server doesn't advertise tools capability", async () => {
    // Regression (#1350): a tools-less server replied to tools/list with
    // -32601 "Method not found", surfacing in the console on every connect.
    const toolless = new FakeInspectorClient({
      capabilities: { prompts: {}, resources: {} },
    });
    toolless.setStatus("connected");
    const toollessState = new ManagedToolsState(toolless);

    const result = await toollessState.refresh();
    expect(result).toEqual([]);
    expect(toolless.listTools).not.toHaveBeenCalled();
  });

  it("connect against a tools-less server doesn't fire listTools", async () => {
    // The connect event runs refresh; the capability gate must also catch it
    // there, not only the publicly-callable refresh().
    const toolless = new FakeInspectorClient({ capabilities: { prompts: {} } });
    toolless.setStatus("connected");
    const toollessState = new ManagedToolsState(toolless);

    toolless.dispatchTypedEvent("connect");
    // Yield so the async refresh chained off connect runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(toolless.listTools).not.toHaveBeenCalled();
    expect(toollessState.getTools()).toEqual([]);
  });

  it("refresh fetches a single page and dispatches toolsChange", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a"), tool("b")] });

    const changePromise = waitForToolsChange(state);
    const result = await state.refresh();

    expect(result.map((t) => t.name)).toEqual(["a", "b"]);
    expect(await changePromise).toEqual(result);
    expect(state.getTools().map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("refresh accumulates across multiple paginated pages", async () => {
    client.setStatus("connected");
    client.queueToolPages(
      { tools: [tool("a")], nextCursor: "c1" },
      { tools: [tool("b")], nextCursor: "c2" },
      { tools: [tool("c")] },
    );

    const result = await state.refresh();
    expect(result.map((t) => t.name)).toEqual(["a", "b", "c"]);
    expect(client.listTools).toHaveBeenCalledTimes(3);
  });

  it("refresh passes setMetadata-supplied metadata to listTools", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "v" });
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();
    expect(client.listTools).toHaveBeenCalledWith(undefined, { k: "v" });
  });

  it("refresh argument overrides setMetadata", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "default" });
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh({ k: "override" });
    expect(client.listTools).toHaveBeenCalledWith(undefined, { k: "override" });
  });

  it("connect event triggers a refresh", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    const changePromise = waitForToolsChange(state);
    client.dispatchTypedEvent("connect");
    const next = await changePromise;
    expect(next.map((t) => t.name)).toEqual(["a"]);
  });

  it("toolsListChanged does NOT auto-refresh by default (the user pulls via Refresh)", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a"), tool("b")] });
    client.dispatchTypedEvent("toolsListChanged");
    // Yield so a stray refresh would have landed.
    await Promise.resolve();
    await Promise.resolve();
    expect(client.listTools).not.toHaveBeenCalled();
    expect(state.getTools()).toEqual([]);
  });

  it("toolsListChanged auto-refreshes when the server opts in", async () => {
    const autoClient = new FakeInspectorClient({
      capabilities: { tools: {} },
      serverSettings: AUTO_REFRESH_SETTINGS,
    });
    autoClient.setStatus("connected");
    const autoState = new ManagedToolsState(autoClient);
    autoClient.queueToolPages({ tools: [tool("a")] });
    const changed = waitForToolsChange(autoState);
    autoClient.dispatchTypedEvent("toolsListChanged");
    expect((await changed).map((t) => t.name)).toEqual(["a"]);
    expect(autoClient.listTools).toHaveBeenCalled();
  });

  it("statusChange to disconnected clears tools and dispatches toolsChange", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();
    expect(state.getTools()).toHaveLength(1);

    const changePromise = waitForToolsChange(state);
    client.setStatus("disconnected");
    const next = await changePromise;
    expect(next).toEqual([]);
    expect(state.getTools()).toEqual([]);
  });

  it("statusChange to other (non-disconnected) values does not clear tools", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();
    client.setStatus("error");
    expect(state.getTools().map((t) => t.name)).toEqual(["a"]);
  });

  it("throws when pagination exceeds 100 pages", async () => {
    client.setStatus("connected");
    // Always returns a non-terminal cursor; refresh should bail out at the cap.
    client.listTools.mockImplementation(async () => ({
      tools: [tool("a")],
      nextCursor: "always",
    }));
    await expect(state.refresh()).rejects.toThrow(/Maximum pagination limit/);
  });

  it("destroy unsubscribes from client events and clears state", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();
    expect(state.getTools()).toHaveLength(1);

    state.destroy();
    expect(state.getTools()).toEqual([]);

    // No further refreshes after destroy(): events on client should be ignored.
    client.queueToolPages({ tools: [tool("b")] });
    client.dispatchTypedEvent("toolsListChanged");
    // Give microtasks a chance to flush so a stray refresh would have landed.
    await Promise.resolve();
    expect(state.getTools()).toEqual([]);
  });

  describe("listChanged (#1402)", () => {
    function waitForListChanged(s: ManagedToolsState): Promise<boolean> {
      return new Promise((resolve) => {
        s.addEventListener("listChangedChange", (e) => resolve(e.detail), {
          once: true,
        });
      });
    }

    it("starts cleared", () => {
      expect(state.getListChanged()).toBe(false);
    });

    it("toolsListChanged sets the flag and dispatches listChangedChange", async () => {
      client.setStatus("connected");
      client.queueToolPages({ tools: [tool("a")] });
      const changed = waitForListChanged(state);
      client.dispatchTypedEvent("toolsListChanged");
      expect(await changed).toBe(true);
      expect(state.getListChanged()).toBe(true);
    });

    it("clearListChanged resets the flag and dispatches false", async () => {
      client.setStatus("connected");
      client.queueToolPages({ tools: [tool("a")] });
      client.dispatchTypedEvent("toolsListChanged");
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
      client.queueToolPages({ tools: [tool("a")] });
      client.dispatchTypedEvent("toolsListChanged");
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
