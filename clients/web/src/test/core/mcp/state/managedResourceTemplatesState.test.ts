import { describe, it, expect, beforeEach } from "vitest";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { ManagedResourceTemplatesState } from "@inspector/core/mcp/state/managedResourceTemplatesState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { waitForChangeEvent } from "./waitForChangeEvent";

function template(name: string): ResourceTemplate {
  return { uriTemplate: `tpl://{${name}}`, name };
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
    // tests exercise the live `listResourceTemplates` path; capability-absent
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

  it("refresh returns early and does not call listResourceTemplates when disconnected", async () => {
    const result = await state.refresh();
    expect(result).toEqual([]);
    expect(client.listResourceTemplates).not.toHaveBeenCalled();
  });

  it("refresh skips listResourceTemplates when the server doesn't advertise resources capability", async () => {
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
    expect(resourceless.listResourceTemplates).not.toHaveBeenCalled();
  });

  it("connect against a resources-less server doesn't fire listResourceTemplates", async () => {
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
    expect(resourceless.listResourceTemplates).not.toHaveBeenCalled();
    expect(resourcelessState.getResourceTemplates()).toEqual([]);
  });

  it("refresh fetches a single page and dispatches resourceTemplatesChange", async () => {
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

  it("refresh accumulates across multiple paginated pages", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages(
      { resourceTemplates: [template("a")], nextCursor: "c1" },
      { resourceTemplates: [template("b")], nextCursor: "c2" },
      { resourceTemplates: [template("c")] },
    );

    const result = await state.refresh();
    expect(result.map((t) => t.name)).toEqual(["a", "b", "c"]);
    expect(client.listResourceTemplates).toHaveBeenCalledTimes(3);
  });

  it("refresh passes setMetadata-supplied metadata", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "v" });
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.refresh();
    expect(client.listResourceTemplates).toHaveBeenCalledWith(undefined, {
      k: "v",
    });
  });

  it("refresh argument overrides setMetadata", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "default" });
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.refresh({ k: "override" });
    expect(client.listResourceTemplates).toHaveBeenCalledWith(undefined, {
      k: "override",
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

  it("resourceTemplatesListChanged does NOT auto-refresh by default (refreshed via the Resources Refresh)", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({
      resourceTemplates: [template("a"), template("b")],
    });
    client.dispatchTypedEvent("resourceTemplatesListChanged");
    // Yield so a stray refresh would have landed.
    await Promise.resolve();
    await Promise.resolve();
    expect(client.listResourceTemplates).not.toHaveBeenCalled();
    expect(state.getResourceTemplates()).toEqual([]);
  });

  it("resourceTemplatesListChanged auto-refreshes when the server opts in", async () => {
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
    expect(autoClient.listResourceTemplates).toHaveBeenCalled();
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

  it("throws when pagination exceeds 100 pages", async () => {
    client.setStatus("connected");
    client.listResourceTemplates.mockImplementation(async () => ({
      resourceTemplates: [template("a")],
      nextCursor: "always",
    }));
    await expect(state.refresh()).rejects.toThrow(/Maximum pagination limit/);
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
