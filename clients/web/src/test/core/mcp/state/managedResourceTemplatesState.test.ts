import { describe, it, expect, beforeEach } from "vitest";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { ManagedResourceTemplatesState } from "@inspector/core/mcp/state/managedResourceTemplatesState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function template(name: string): ResourceTemplate {
  return { uriTemplate: `tpl://{${name}}`, name };
}

function waitForChange(
  state: ManagedResourceTemplatesState,
): Promise<ResourceTemplate[]> {
  return new Promise((resolve) => {
    state.addEventListener(
      "resourceTemplatesChange",
      (e) => resolve(e.detail),
      { once: true },
    );
  });
}

describe("ManagedResourceTemplatesState", () => {
  let client: FakeInspectorClient;
  let state: ManagedResourceTemplatesState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new ManagedResourceTemplatesState(client);
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

  it("resourceTemplatesListChanged event triggers a refresh", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({
      resourceTemplates: [template("a"), template("b")],
    });
    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("resourceTemplatesListChanged");
    const next = await changePromise;
    expect(next.map((t) => t.name)).toEqual(["a", "b"]);
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

  it("statusChange to other values does not clear templates", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.refresh();
    client.setStatus("error");
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
