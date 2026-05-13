import { describe, it, expect, beforeEach } from "vitest";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { ManagedResourcesState } from "@inspector/core/mcp/state/managedResourcesState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function resource(uri: string): Resource {
  return { uri, name: uri };
}

function waitForResourcesChange(
  state: ManagedResourcesState,
): Promise<Resource[]> {
  return new Promise((resolve) => {
    state.addEventListener("resourcesChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

describe("ManagedResourcesState", () => {
  let client: FakeInspectorClient;
  let state: ManagedResourcesState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new ManagedResourcesState(client);
  });

  it("starts with empty resources", () => {
    expect(state.getResources()).toEqual([]);
  });

  it("getResources returns a defensive copy", () => {
    const a = state.getResources();
    const b = state.getResources();
    expect(a).not.toBe(b);
  });

  it("refresh returns early and does not call listResources when disconnected", async () => {
    const result = await state.refresh();
    expect(result).toEqual([]);
    expect(client.listResources).not.toHaveBeenCalled();
  });

  it("refresh fetches a single page and dispatches resourcesChange", async () => {
    client.setStatus("connected");
    client.queueResourcePages({
      resources: [resource("a://1"), resource("a://2")],
    });

    const changePromise = waitForResourcesChange(state);
    const result = await state.refresh();

    expect(result.map((r) => r.uri)).toEqual(["a://1", "a://2"]);
    expect(await changePromise).toEqual(result);
    expect(state.getResources().map((r) => r.uri)).toEqual(["a://1", "a://2"]);
  });

  it("refresh accumulates across multiple paginated pages", async () => {
    client.setStatus("connected");
    client.queueResourcePages(
      { resources: [resource("a://1")], nextCursor: "c1" },
      { resources: [resource("a://2")], nextCursor: "c2" },
      { resources: [resource("a://3")] },
    );

    const result = await state.refresh();
    expect(result.map((r) => r.uri)).toEqual(["a://1", "a://2", "a://3"]);
    expect(client.listResources).toHaveBeenCalledTimes(3);
  });

  it("refresh passes setMetadata-supplied metadata to listResources", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "v" });
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.refresh();
    expect(client.listResources).toHaveBeenCalledWith(undefined, { k: "v" });
  });

  it("refresh argument overrides setMetadata", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "default" });
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.refresh({ k: "override" });
    expect(client.listResources).toHaveBeenCalledWith(undefined, {
      k: "override",
    });
  });

  it("connect event triggers a refresh", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    const changePromise = waitForResourcesChange(state);
    client.dispatchTypedEvent("connect");
    const next = await changePromise;
    expect(next.map((r) => r.uri)).toEqual(["a://1"]);
  });

  it("resourcesListChanged event triggers a refresh", async () => {
    client.setStatus("connected");
    client.queueResourcePages({
      resources: [resource("a://1"), resource("a://2")],
    });
    const changePromise = waitForResourcesChange(state);
    client.dispatchTypedEvent("resourcesListChanged");
    const next = await changePromise;
    expect(next.map((r) => r.uri)).toEqual(["a://1", "a://2"]);
  });

  it("statusChange to disconnected clears resources and dispatches resourcesChange", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.refresh();
    expect(state.getResources()).toHaveLength(1);

    const changePromise = waitForResourcesChange(state);
    client.setStatus("disconnected");
    const next = await changePromise;
    expect(next).toEqual([]);
    expect(state.getResources()).toEqual([]);
  });

  it("statusChange to other (non-disconnected) values does not clear resources", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.refresh();
    client.setStatus("error");
    expect(state.getResources().map((r) => r.uri)).toEqual(["a://1"]);
  });

  it("throws when pagination exceeds 100 pages", async () => {
    client.setStatus("connected");
    client.listResources.mockImplementation(async () => ({
      resources: [resource("a://1")],
      nextCursor: "always",
    }));
    await expect(state.refresh()).rejects.toThrow(/Maximum pagination limit/);
  });

  it("destroy unsubscribes from client events and clears state", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.refresh();
    expect(state.getResources()).toHaveLength(1);

    state.destroy();
    expect(state.getResources()).toEqual([]);

    client.queueResourcePages({ resources: [resource("a://2")] });
    client.dispatchTypedEvent("resourcesListChanged");
    await Promise.resolve();
    expect(state.getResources()).toEqual([]);
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
