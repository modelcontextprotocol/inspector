import { describe, it, expect, beforeEach } from "vitest";
import type { Resource } from "@modelcontextprotocol/client";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { PagedResourcesState } from "@inspector/core/mcp/state/pagedResourcesState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function resource(uri: string): Resource {
  return { uri, name: uri };
}

const PAGINATED_SETTINGS: InspectorServerSettings = {
  headers: [],
  env: [],
  metadata: {},
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  roots: [],
  paginatedLists: true,
};

function waitForChange(state: PagedResourcesState): Promise<Resource[]> {
  return new Promise((resolve) => {
    state.addEventListener("resourcesChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

function waitForError(state: PagedResourcesState): Promise<Error | null> {
  return new Promise((resolve) => {
    state.addEventListener("errorChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

describe("PagedResourcesState", () => {
  let client: FakeInspectorClient;
  let state: PagedResourcesState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new PagedResourcesState(client);
  });

  it("starts empty and returns defensive copies", () => {
    expect(state.getResources()).toEqual([]);
    expect(state.getResources()).not.toBe(state.getResources());
  });

  it("loadPage no-ops when disconnected", async () => {
    const result = await state.loadPage();
    expect(result).toEqual({ resources: [], nextCursor: undefined });
    expect(client.listResources).not.toHaveBeenCalled();
  });

  it("loadPage without cursor replaces the aggregated list", async () => {
    client.setStatus("connected");
    client.queueResourcePages({
      resources: [resource("a://1"), resource("a://2")],
    });
    const changePromise = waitForChange(state);
    const result = await state.loadPage();
    expect(result.resources.map((r) => r.uri)).toEqual(["a://1", "a://2"]);
    expect(await changePromise).toEqual(result.resources);
  });

  it("loadPage with cursor appends to the aggregated list", async () => {
    client.setStatus("connected");
    client.queueResourcePages(
      { resources: [resource("a://1")], nextCursor: "c1" },
      { resources: [resource("a://2")] },
    );
    await state.loadPage();
    await state.loadPage("c1");
    expect(state.getResources().map((r) => r.uri)).toEqual(["a://1", "a://2"]);
  });

  it("loadPage forwards metadata", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.loadPage(undefined, { k: "v" });
    expect(client.listResources).toHaveBeenCalledWith(undefined, { k: "v" });
  });

  it("clear empties the aggregated list and dispatches", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.loadPage();
    const changePromise = waitForChange(state);
    state.clear();
    expect(await changePromise).toEqual([]);
    expect(state.getResources()).toEqual([]);
  });

  it("statusChange to disconnected clears resources", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.loadPage();
    const changePromise = waitForChange(state);
    client.setStatus("disconnected");
    expect(await changePromise).toEqual([]);
  });

  it("statusChange to error clears resources (error is terminal, #1490)", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.loadPage();
    const changePromise = waitForChange(state);
    client.setStatus("error");
    expect(await changePromise).toEqual([]);
    expect(state.getResources()).toEqual([]);
  });

  it("statusChange to a non-terminal value (connecting) is a no-op", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.loadPage();
    client.setStatus("connecting");
    expect(state.getResources().map((r) => r.uri)).toEqual(["a://1"]);
  });

  it("destroy stops listening and clears state", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.loadPage();
    state.destroy();
    expect(state.getResources()).toEqual([]);
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });

  it("ignores a concurrent loadPage (double-click guard, #1721)", async () => {
    client.setStatus("connected");
    client.queueResourcePages(
      { resources: [resource("a://1")], nextCursor: "c1" },
      { resources: [resource("a://2")], nextCursor: "c2" },
    );
    await state.loadPage();
    const [r1, r2] = await Promise.all([
      state.loadPage("c1"),
      state.loadPage("c1"),
    ]);
    expect(r1.resources.map((r) => r.uri)).toEqual(["a://2"]);
    expect(r2.resources).toEqual([]);
    expect(r2.nextCursor).toBe("c1");
    expect(state.getResources().map((r) => r.uri)).toEqual(["a://1", "a://2"]);
    expect(state.getPagination().pageCount).toBe(2);
  });

  describe("pagination progress + connect auto-load (#1721)", () => {
    it("tracks nextCursor/page count and dispatches paginationChange", async () => {
      client.setStatus("connected");
      client.queueResourcePages(
        { resources: [resource("a://1")], nextCursor: "c1" },
        { resources: [resource("a://2")] },
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
      client.queueResourcePages({
        resources: [resource("a://1")],
        nextCursor: "c1",
      });
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

    it("loads page 1 on connect in paginated mode, not otherwise", async () => {
      const spClient = new FakeInspectorClient({
        serverSettings: PAGINATED_SETTINGS,
      });
      spClient.setStatus("connected");
      const spState = new PagedResourcesState(spClient);
      spClient.queueResourcePages({ resources: [resource("a://1")] });
      const changed = waitForChange(spState);
      spClient.dispatchTypedEvent("connect");
      expect((await changed).map((r) => r.uri)).toEqual(["a://1"]);
      spState.destroy();

      client.setStatus("connected");
      client.dispatchTypedEvent("connect");
      await Promise.resolve();
      expect(client.listResources).not.toHaveBeenCalled();
    });
  });

  // #1998: in paginated mode this store — not the managed one — drives the
  // sidebar, so a failed page must surface here or the panel renders empty
  // with no alert and no Retry.
  describe("load errors (#1998)", () => {
    it("records the failure, dispatches errorChange, and re-throws", async () => {
      client.setStatus("connected");
      const boom = new Error("list failed");
      client.listResources.mockRejectedValueOnce(boom);
      const errorPromise = waitForError(state);
      await expect(state.loadPage()).rejects.toThrow("list failed");
      expect(await errorPromise).toBe(boom);
      expect(state.getError()).toBe(boom);
    });

    it("wraps a non-Error rejection", async () => {
      client.setStatus("connected");
      client.listResources.mockRejectedValueOnce("plain string");
      await expect(state.loadPage()).rejects.toBe("plain string");
      expect(state.getError()?.message).toBe("plain string");
    });

    it("clears the error on the next successful load", async () => {
      client.setStatus("connected");
      client.listResources.mockRejectedValueOnce(new Error("list failed"));
      await expect(state.loadPage()).rejects.toThrow();
      client.queueResourcePages({ resources: [resource("a://1")] });
      const cleared = waitForError(state);
      await state.loadPage();
      expect(await cleared).toBeNull();
      expect(state.getError()).toBeNull();
    });

    it("clears the error on disconnect", async () => {
      client.setStatus("connected");
      client.listResources.mockRejectedValueOnce(new Error("list failed"));
      await expect(state.loadPage()).rejects.toThrow();
      const cleared = waitForError(state);
      client.setStatus("disconnected");
      expect(await cleared).toBeNull();
    });

    it("records a connect-time auto-load failure instead of floating it", async () => {
      const spClient = new FakeInspectorClient({
        serverSettings: PAGINATED_SETTINGS,
      });
      spClient.setStatus("connected");
      const spState = new PagedResourcesState(spClient);
      const boom = new Error("connect-time list failed");
      spClient.listResources.mockRejectedValueOnce(boom);
      const errored = waitForError(spState);
      spClient.dispatchTypedEvent("connect");
      expect(await errored).toBe(boom);
      expect(spState.getError()).toBe(boom);
      spState.destroy();
    });
  });
});
