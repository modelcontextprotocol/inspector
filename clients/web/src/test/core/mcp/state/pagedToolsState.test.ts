import { describe, it, expect, beforeEach } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { PagedToolsState } from "@inspector/core/mcp/state/pagedToolsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function tool(name: string): Tool {
  return { name, inputSchema: { type: "object" } };
}

const PAGINATED_SETTINGS: InspectorServerSettings = {
  headers: [],
  env: [],
  metadata: [],
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  roots: [],
  paginatedLists: true,
};

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

  it("statusChange to error clears tools (error is terminal, #1490)", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.loadPage();
    const changePromise = waitForChange(state);
    client.setStatus("error");
    expect(await changePromise).toEqual([]);
    expect(state.getTools()).toEqual([]);
  });

  it("statusChange to a non-terminal value (connecting) is a no-op", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.loadPage();
    client.setStatus("connecting");
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

  describe("pagination progress (#1721)", () => {
    it("tracks nextCursor and page count across loads", async () => {
      client.setStatus("connected");
      client.queueToolPages(
        { tools: [tool("a")], nextCursor: "c1" },
        { tools: [tool("b")] },
      );
      expect(state.getPagination()).toEqual({
        nextCursor: undefined,
        pageCount: 0,
      });
      await state.loadPage();
      expect(state.getPagination()).toEqual({ nextCursor: "c1", pageCount: 1 });
      await state.loadPage("c1");
      expect(state.getPagination()).toEqual({
        nextCursor: undefined,
        pageCount: 2,
      });
    });

    it("dispatches paginationChange on load and reset", async () => {
      client.setStatus("connected");
      client.queueToolPages({ tools: [tool("a")], nextCursor: "c1" });
      const onLoad = new Promise<{ nextCursor?: string; pageCount: number }>(
        (resolve) => {
          state.addEventListener("paginationChange", (e) => resolve(e.detail), {
            once: true,
          });
        },
      );
      await state.loadPage();
      expect(await onLoad).toEqual({ nextCursor: "c1", pageCount: 1 });

      const onClear = new Promise<{ nextCursor?: string; pageCount: number }>(
        (resolve) => {
          state.addEventListener("paginationChange", (e) => resolve(e.detail), {
            once: true,
          });
        },
      );
      state.clear();
      expect(await onClear).toEqual({ nextCursor: undefined, pageCount: 0 });
    });

    it("resets pagination when the connection goes terminal", async () => {
      client.setStatus("connected");
      client.queueToolPages({ tools: [tool("a")], nextCursor: "c1" });
      await state.loadPage();
      client.setStatus("disconnected");
      expect(state.getPagination()).toEqual({
        nextCursor: undefined,
        pageCount: 0,
      });
    });
  });

  it("ignores a concurrent loadPage (double-click guard, #1721)", async () => {
    // Two overlapping loadPage(cursor) calls must not both append the same
    // page. The second (while the first is in flight) is a no-op that returns
    // the current cursor.
    client.setStatus("connected");
    client.queueToolPages(
      { tools: [tool("a")], nextCursor: "c1" },
      { tools: [tool("b")], nextCursor: "c2" },
    );
    await state.loadPage(); // page 1 → cursor c1
    const first = state.loadPage("c1");
    const second = state.loadPage("c1"); // concurrent — should be dropped
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.tools.map((t) => t.name)).toEqual(["b"]);
    expect(r2.tools).toEqual([]); // guarded no-op
    expect(r2.nextCursor).toBe("c1"); // preserves the in-flight cursor
    // Page appended exactly once.
    expect(state.getTools().map((t) => t.name)).toEqual(["a", "b"]);
    expect(state.getPagination().pageCount).toBe(2);
  });

  describe("connect auto-load (#1721)", () => {
    it("loads page 1 on connect in paginated mode", async () => {
      const spClient = new FakeInspectorClient({
        serverSettings: PAGINATED_SETTINGS,
      });
      spClient.setStatus("connected");
      const spState = new PagedToolsState(spClient);
      spClient.queueToolPages({ tools: [tool("a")], nextCursor: "c1" });
      const changed = waitForChange(spState);
      spClient.dispatchTypedEvent("connect");
      expect((await changed).map((t) => t.name)).toEqual(["a"]);
      expect(spState.getPagination()).toEqual({
        nextCursor: "c1",
        pageCount: 1,
      });
      spState.destroy();
    });

    it("does NOT load on connect when paginated mode is off", async () => {
      client.setStatus("connected");
      client.queueToolPages({ tools: [tool("a")] });
      client.dispatchTypedEvent("connect");
      await Promise.resolve();
      expect(client.listTools).not.toHaveBeenCalled();
      expect(state.getTools()).toEqual([]);
    });
  });
});
