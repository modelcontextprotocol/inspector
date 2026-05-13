import { describe, it, expect, beforeEach } from "vitest";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { PagedResourceTemplatesState } from "@inspector/core/mcp/state/pagedResourceTemplatesState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function template(name: string): ResourceTemplate {
  return { uriTemplate: `tpl://{${name}}`, name };
}

function waitForChange(
  state: PagedResourceTemplatesState,
): Promise<ResourceTemplate[]> {
  return new Promise((resolve) => {
    state.addEventListener(
      "resourceTemplatesChange",
      (e) => resolve(e.detail),
      { once: true },
    );
  });
}

describe("PagedResourceTemplatesState", () => {
  let client: FakeInspectorClient;
  let state: PagedResourceTemplatesState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new PagedResourceTemplatesState(client);
  });

  it("starts empty and returns defensive copies", () => {
    expect(state.getResourceTemplates()).toEqual([]);
    expect(state.getResourceTemplates()).not.toBe(state.getResourceTemplates());
  });

  it("loadPage no-ops when disconnected", async () => {
    const result = await state.loadPage();
    expect(result).toEqual({ resourceTemplates: [], nextCursor: undefined });
    expect(client.listResourceTemplates).not.toHaveBeenCalled();
  });

  it("loadPage without cursor replaces the aggregated list", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({
      resourceTemplates: [template("a"), template("b")],
    });
    const changePromise = waitForChange(state);
    const result = await state.loadPage();
    expect(result.resourceTemplates.map((t) => t.name)).toEqual(["a", "b"]);
    expect(await changePromise).toEqual(result.resourceTemplates);
  });

  it("loadPage with cursor appends to the aggregated list", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages(
      { resourceTemplates: [template("a")], nextCursor: "c1" },
      { resourceTemplates: [template("b")] },
    );
    await state.loadPage();
    await state.loadPage("c1");
    expect(state.getResourceTemplates().map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("loadPage forwards metadata", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.loadPage(undefined, { k: "v" });
    expect(client.listResourceTemplates).toHaveBeenCalledWith(undefined, {
      k: "v",
    });
  });

  it("clear empties the aggregated list and dispatches", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.loadPage();
    const changePromise = waitForChange(state);
    state.clear();
    expect(await changePromise).toEqual([]);
    expect(state.getResourceTemplates()).toEqual([]);
  });

  it("statusChange to disconnected clears templates", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.loadPage();
    const changePromise = waitForChange(state);
    client.setStatus("disconnected");
    expect(await changePromise).toEqual([]);
  });

  it("statusChange to non-disconnected values is a no-op", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.loadPage();
    client.setStatus("error");
    expect(state.getResourceTemplates().map((t) => t.name)).toEqual(["a"]);
  });

  it("destroy stops listening and clears state", async () => {
    client.setStatus("connected");
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.loadPage();
    state.destroy();
    expect(state.getResourceTemplates()).toEqual([]);
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
