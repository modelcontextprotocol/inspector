import { describe, it, expect, beforeEach } from "vitest";
import type { ResourceTemplateType as ResourceTemplate } from "@modelcontextprotocol/client";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { ManagedResourceTemplatesState } from "@inspector/core/mcp/state/managedResourceTemplatesState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { waitForChangeEvent } from "./waitForChangeEvent";

function template(name: string): ResourceTemplate {
  return { uriTemplate: `tpl://{${name}}`, name };
}

const AUTO_REFRESH_SETTINGS: InspectorServerSettings = {
  headers: [],
  env: [],
  metadata: [],
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  autoRefreshOnListChanged: true,
  roots: [],
};

function waitForChange(
  state: ManagedResourceTemplatesState,
): Promise<ResourceTemplate[]> {
  return waitForChangeEvent(state, "resourceTemplatesChange");
}

describe("ManagedResourceTemplatesState", () => {
  let client: FakeInspectorClient;
  let state: ManagedResourceTemplatesState;

  beforeEach(() => {
    // Default to a server that advertises `resources` so the existing flow
    // tests exercise the live `listAllResourceTemplates` path; capability-absent
    // tests below override this. (Templates are gated on the `resources`
    // capability — the spec defines no separate `resourceTemplates` one.)
    client = new FakeInspectorClient({ capabilities: { resources: {} } });
    state = new ManagedResourceTemplatesState(client, 0);
  });

  it("starts with empty resource templates", () => {
    expect(state.getResourceTemplates()).toEqual([]);
  });

  it("getResourceTemplates returns a defensive copy", () => {
    const a = state.getResourceTemplates();
    const b = state.getResourceTemplates();
    expect(a).not.toBe(b);
  });

  it("refresh returns early and does not call listAllResourceTemplates when disconnected", async () => {
    const result = await state.refresh();
    expect(result).toEqual([]);
    expect(client.listAllResourceTemplates).not.toHaveBeenCalled();
  });

  it("refresh skips listAllResourceTemplates when the server doesn't advertise resources capability", async () => {
    // Regression (#1350): templates are part of the resources surface, so a
    // resources-less server replied to resources/templates/list with -32601
    // "Method not found", surfacing in the console on every connect.
    const resourceless = new FakeInspectorClient({
      capabilities: { tools: {}, prompts: {} },
    });
    resourceless.setStatus("connected");
    const resourcelessState = new ManagedResourceTemplatesState(
      resourceless,
      0,
    );

    const result = await resourcelessState.refresh();
    expect(result).toEqual([]);
    expect(resourceless.listAllResourceTemplates).not.toHaveBeenCalled();
  });

  it("connect against a resources-less server doesn't fire listAllResourceTemplates", async () => {
    // The connect event runs refresh; the capability gate must also catch it
    // there, not only the publicly-callable refresh().
    const resourceless = new FakeInspectorClient({
      capabilities: { tools: {} },
    });
    resourceless.setStatus("connected");
    const resourcelessState = new ManagedResourceTemplatesState(
      resourceless,
      0,
    );

    const changePromise = waitForChange(resourcelessState);
    resourceless.dispatchTypedEvent("connect");
    await changePromise;
    expect(resourceless.listAllResourceTemplates).not.toHaveBeenCalled();
    expect(resourcelessState.getResourceTemplates()).toEqual([]);
  });

  it("refresh fetches the full list and dispatches resourceTemplatesChange", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({
      resourceTemplates: [template("a"), template("b")],
    });

    const changePromise = waitForChange(state);
    const result = await state.refresh();

    expect(result.map((t) => t.name)).toEqual(["a", "b"]);
    expect(await changePromise).toEqual(result);
    expect(state.getResourceTemplates().map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("refresh delegates all-page aggregation to listAllResourceTemplates (one call)", async () => {
    // The SDK's high-level verb walks every page; the managed state makes a
    // single `listAllResourceTemplates` call rather than looping single pages itself.
    client.setStatus("connected");
    client.queueResourceTemplatePages(
      { resourceTemplates: [template("a")], nextCursor: "c1" },
      { resourceTemplates: [template("b")], nextCursor: "c2" },
      { resourceTemplates: [template("c")] },
    );

    const result = await state.refresh();
    expect(result.map((t) => t.name)).toEqual(["a", "b", "c"]);
    expect(client.listAllResourceTemplates).toHaveBeenCalledTimes(1);
  });

  it("refresh passes setMetadata-supplied metadata", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "v" });
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.refresh();
    expect(client.listAllResourceTemplates).toHaveBeenCalledWith({
      cacheMode: undefined,
      metadata: { k: "v" },
    });
  });

  it("refresh argument overrides setMetadata", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "default" });
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.refresh({ k: "override" });
    expect(client.listAllResourceTemplates).toHaveBeenCalledWith({
      cacheMode: undefined,
      metadata: { k: "override" },
    });
  });

  it("connect event triggers a refresh", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("connect");
    const next = await changePromise;
    expect(next.map((t) => t.name)).toEqual(["a"]);
  });

  it("STILL loads on connect in paginated mode (no paged counterpart, #1721)", async () => {
    // Unlike tools/prompts/resources, resource templates have no paged
    // counterpart, so they must aggregate on connect even when
    // `paginatedLists` is on — otherwise the list would be empty until a
    // manual refresh (deferWhenPaginated: false).
    const spClient = new FakeInspectorClient({
      capabilities: { resources: {} },
      serverSettings: { ...AUTO_REFRESH_SETTINGS, paginatedLists: true },
    });
    spClient.setStatus("connected");
    const spState = new ManagedResourceTemplatesState(spClient, 0);
    spClient.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    const changePromise = waitForChange(spState);
    spClient.dispatchTypedEvent("connect");
    expect((await changePromise).map((t) => t.name)).toEqual(["a"]);
    expect(spClient.listAllResourceTemplates).toHaveBeenCalled();
    spState.destroy();
  });

  it("resourceTemplatesListChanged does NOT auto-refresh by default (refreshed via the Resources Refresh)", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({
      resourceTemplates: [template("a"), template("b")],
    });
    client.dispatchTypedEvent("resourceTemplatesListChanged");
    // Yield so a stray refresh would have landed.
    await Promise.resolve();
    await Promise.resolve();
    expect(client.listAllResourceTemplates).not.toHaveBeenCalled();
    expect(state.getResourceTemplates()).toEqual([]);
  });

  it("resourceTemplatesListChanged auto-refreshes (cacheMode:refresh) when the server opts in", async () => {
    const autoClient = new FakeInspectorClient({
      capabilities: { resources: {} },
      serverSettings: AUTO_REFRESH_SETTINGS,
    });
    autoClient.setStatus("connected");
    const autoState = new ManagedResourceTemplatesState(autoClient, 0);
    autoClient.queueResourceTemplatePages({
      resourceTemplates: [template("a")],
    });
    const changed = waitForChange(autoState);
    autoClient.dispatchTypedEvent("resourceTemplatesListChanged");
    expect((await changed).map((t) => t.name)).toEqual(["a"]);
    // A list_changed means the prior list is stale → bypass the cache.
    expect(autoClient.listAllResourceTemplates).toHaveBeenCalledWith({
      cacheMode: "refresh",
      metadata: undefined,
    });
  });

  it("statusChange to disconnected clears templates and dispatches change", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.refresh();
    expect(state.getResourceTemplates()).toHaveLength(1);

    const changePromise = waitForChange(state);
    client.setStatus("disconnected");
    const next = await changePromise;
    expect(next).toEqual([]);
    expect(state.getResourceTemplates()).toEqual([]);
  });

  it("statusChange to error clears templates (error is terminal, #1490)", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.refresh();
    expect(state.getResourceTemplates()).toHaveLength(1);

    const changePromise = waitForChange(state);
    client.setStatus("error");
    const next = await changePromise;
    expect(next).toEqual([]);
    expect(state.getResourceTemplates()).toEqual([]);
  });

  it("statusChange to a non-terminal value (connecting) does not clear templates", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.refresh();
    client.setStatus("connecting");
    expect(state.getResourceTemplates().map((t) => t.name)).toEqual(["a"]);
  });

  it("refresh forwards an explicit cacheMode to listAllResourceTemplates", async () => {
    // A user-initiated refresh (via the hook) passes cacheMode:"refresh" to
    // force a cache-bypassing round trip on modern servers (#1721).
    client.setStatus("connected");
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.refresh(undefined, "refresh");
    expect(client.listAllResourceTemplates).toHaveBeenCalledWith({
      cacheMode: "refresh",
      metadata: undefined,
    });
  });

  it("destroy unsubscribes from client events and clears state", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.refresh();
    expect(state.getResourceTemplates()).toHaveLength(1);

    state.destroy();
    expect(state.getResourceTemplates()).toEqual([]);

    client.queueResourceTemplatePages({ resourceTemplates: [template("b")] });
    client.dispatchTypedEvent("resourceTemplatesListChanged");
    await Promise.resolve();
    expect(state.getResourceTemplates()).toEqual([]);
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
