import { describe, it, expect, beforeEach } from "vitest";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { PagedResourcesState } from "@inspector/core/mcp/state/pagedResourcesState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function resource(uri: string): Resource {
  return { uri, name: uri };
}

function waitForChange(state: PagedResourcesState): Promise<Resource[]> {
  return new Promise((resolve) => {
    state.addEventListener("resourcesChange", (e) => resolve(e.detail), {
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

  it("statusChange to non-disconnected values is a no-op", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.loadPage();
    client.setStatus("error");
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
});
