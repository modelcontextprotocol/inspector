import { describe, it, expect, beforeEach } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { PagedToolsState } from "@inspector/core/mcp/state/pagedToolsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function tool(name: string): Tool {
  return { name, inputSchema: { type: "object" } };
}

function waitForChange(state: PagedToolsState): Promise<Tool[]> {
  return new Promise((resolve) => {
    state.addEventListener("toolsChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

describe("PagedToolsState", () => {
  let client: FakeInspectorClient;
  let state: PagedToolsState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new PagedToolsState(client);
  });

  it("starts empty and returns defensive copies", () => {
    expect(state.getTools()).toEqual([]);
    expect(state.getTools()).not.toBe(state.getTools());
  });

  it("loadPage no-ops when disconnected", async () => {
    const result = await state.loadPage();
    expect(result).toEqual({ tools: [], nextCursor: undefined });
    expect(client.listTools).not.toHaveBeenCalled();
  });

  it("loadPage without cursor replaces the aggregated list", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a"), tool("b")] });
    const changePromise = waitForChange(state);
    const result = await state.loadPage();
    expect(result.tools.map((t) => t.name)).toEqual(["a", "b"]);
    expect(await changePromise).toEqual(result.tools);
  });

  it("loadPage with cursor appends to the aggregated list", async () => {
    client.setStatus("connected");
    client.queueToolPages(
      { tools: [tool("a")], nextCursor: "c1" },
      { tools: [tool("b")] },
    );
    const first = await state.loadPage();
    expect(first.nextCursor).toBe("c1");
    const second = await state.loadPage("c1");
    expect(second.nextCursor).toBeUndefined();
    expect(state.getTools().map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("clear empties the aggregated list and dispatches", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.loadPage();
    const changePromise = waitForChange(state);
    state.clear();
    expect(await changePromise).toEqual([]);
    expect(state.getTools()).toEqual([]);
  });

  it("statusChange to disconnected clears tools", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.loadPage();
    const changePromise = waitForChange(state);
    client.setStatus("disconnected");
    expect(await changePromise).toEqual([]);
    expect(state.getTools()).toEqual([]);
  });

  it("statusChange to non-disconnected values is a no-op", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.loadPage();
    client.setStatus("error");
    expect(state.getTools().map((t) => t.name)).toEqual(["a"]);
  });

  it("does not subscribe to toolsListChanged (paged is caller-driven)", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    client.dispatchTypedEvent("toolsListChanged");
    await Promise.resolve();
    expect(state.getTools()).toEqual([]);
    expect(client.listTools).not.toHaveBeenCalled();
  });

  it("destroy stops listening and clears state", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.loadPage();
    state.destroy();
    expect(state.getTools()).toEqual([]);

    client.setStatus("disconnected");
    await Promise.resolve();
    expect(state.getTools()).toEqual([]);
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
