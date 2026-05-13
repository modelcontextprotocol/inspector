import { describe, it, expect, beforeEach } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ManagedToolsState } from "@inspector/core/mcp/state/managedToolsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function tool(name: string): Tool {
  return { name, inputSchema: { type: "object" } };
}

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
    client = new FakeInspectorClient();
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

  it("toolsListChanged event triggers a refresh", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a"), tool("b")] });
    const changePromise = waitForToolsChange(state);
    client.dispatchTypedEvent("toolsListChanged");
    const next = await changePromise;
    expect(next.map((t) => t.name)).toEqual(["a", "b"]);
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

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
