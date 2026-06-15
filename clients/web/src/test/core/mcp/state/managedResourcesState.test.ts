import { describe, it, expect, beforeEach } from "vitest";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { ManagedResourcesState } from "@inspector/core/mcp/state/managedResourcesState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function resource(uri: string): Resource {
  return { uri, name: uri };
}

const AUTO_REFRESH_SETTINGS: InspectorServerSettings = {
  headers: [],
  metadata: [],
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  autoRefreshOnListChanged: true,
  roots: [],
};

function waitForResourcesChange(
  state: ManagedResourcesState,
): Promise<Resource[]> {
  return new Promise((resolve) => {
    state.addEventListener("resourcesChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

function waitForListChanged(state: ManagedResourcesState): Promise<boolean> {
  return new Promise((resolve) => {
    state.addEventListener("listChangedChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

describe("ManagedResourcesState", () => {
  let client: FakeInspectorClient;
  let state: ManagedResourcesState;

  beforeEach(() => {
    // Default to a server that advertises `resources` so the existing flow
    // tests exercise the live `listResources` path; capability-absent tests
    // below override this.
    client = new FakeInspectorClient({ capabilities: { resources: {} } });
    state = new ManagedResourcesState(client, 0);
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

  it("refresh skips listResources when the server doesn't advertise resources capability", async () => {
    // Regression (#1350): a resources-less server replied to resources/list
    // with -32601 "Method not found", surfacing in the console on every
    // connect.
    const resourceless = new FakeInspectorClient({
      capabilities: { tools: {}, prompts: {} },
    });
    resourceless.setStatus("connected");
    const resourcelessState = new ManagedResourcesState(resourceless, 0);

    const result = await resourcelessState.refresh();
    expect(result).toEqual([]);
    expect(resourceless.listResources).not.toHaveBeenCalled();
  });

  it("connect against a resources-less server doesn't fire listResources", async () => {
    // The connect event runs refresh; the capability gate must also catch it
    // there, not only the publicly-callable refresh().
    const resourceless = new FakeInspectorClient({
      capabilities: { tools: {} },
    });
    resourceless.setStatus("connected");
    const resourcelessState = new ManagedResourcesState(resourceless, 0);

    resourceless.dispatchTypedEvent("connect");
    // Yield so the async refresh chained off connect runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(resourceless.listResources).not.toHaveBeenCalled();
    expect(resourcelessState.getResources()).toEqual([]);
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

  it("resourcesListChanged lights the indicator without fetching by default (#1444)", async () => {
    // Auto-refresh off: a list_changed lights the indicator with NO list call;
    // the user pulls the new list via Refresh.
    client.setStatus("connected");
    const changed = waitForListChanged(state);
    client.dispatchTypedEvent("resourcesListChanged");
    expect(await changed).toBe(true);
    expect(client.listResources).not.toHaveBeenCalled(); // no automatic fetch
    expect(state.getResources()).toEqual([]); // displayed list untouched
  });

  it("resourcesListChanged auto-refreshes when the server opts in", async () => {
    const autoClient = new FakeInspectorClient({
      capabilities: { resources: {} },
      serverSettings: AUTO_REFRESH_SETTINGS,
    });
    autoClient.setStatus("connected");
    const autoState = new ManagedResourcesState(autoClient, 0);
    autoClient.queueResourcePages({ resources: [resource("a://1")] });
    const changed = waitForResourcesChange(autoState);
    autoClient.dispatchTypedEvent("resourcesListChanged");
    expect((await changed).map((r) => r.uri)).toEqual(["a://1"]);
    expect(autoClient.listResources).toHaveBeenCalled();
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

  it("statusChange to error clears resources (error is terminal, #1490)", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.refresh();
    expect(state.getResources()).toHaveLength(1);

    const changePromise = waitForResourcesChange(state);
    client.setStatus("error");
    const next = await changePromise;
    expect(next).toEqual([]);
    expect(state.getResources()).toEqual([]);
  });

  it("statusChange to a non-terminal value (connecting) does not clear resources", async () => {
    client.setStatus("connected");
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.refresh();
    client.setStatus("connecting");
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

  describe("listChanged (#1402)", () => {
    it("starts cleared", () => {
      expect(state.getListChanged()).toBe(false);
    });

    it("resourcesListChanged sets the flag and dispatches listChangedChange", async () => {
      client.setStatus("connected");
      client.queueResourcePages({ resources: [resource("a://1")] });
      const changed = waitForListChanged(state);
      client.dispatchTypedEvent("resourcesListChanged");
      expect(await changed).toBe(true);
      expect(state.getListChanged()).toBe(true);
    });

    it("clearListChanged resets the flag and dispatches false", async () => {
      client.setStatus("connected");
      client.queueResourcePages({ resources: [resource("a://1")] });
      const set = waitForListChanged(state);
      client.dispatchTypedEvent("resourcesListChanged");
      await set; // wait for the debounced notification to set the flag
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
      client.queueResourcePages({ resources: [resource("a://1")] });
      const set = waitForListChanged(state);
      client.dispatchTypedEvent("resourcesListChanged");
      await set; // wait for the debounced notification to set the flag
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
