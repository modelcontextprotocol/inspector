import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { PagedResourceTemplatesState } from "@inspector/core/mcp/state/pagedResourceTemplatesState";
import { usePagedResourceTemplates } from "@inspector/core/react/usePagedResourceTemplates";

function template(name: string): ResourceTemplate {
  return { uriTemplate: `tpl://{${name}}`, name };
}

describe("usePagedResourceTemplates", () => {
  let client: FakeInspectorClient;
  let state: PagedResourceTemplatesState;

  beforeEach(() => {
    client = new FakeInspectorClient({ status: "connected" });
    state = new PagedResourceTemplatesState(client);
  });

  it("returns the initial snapshot from the state", async () => {
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.loadPage();
    const { result } = renderHook(() =>
      usePagedResourceTemplates(client, state),
    );
    expect(result.current.resourceTemplates.map((t) => t.name)).toEqual(["a"]);
  });

  it("returns empty when state is null", () => {
    const { result } = renderHook(() =>
      usePagedResourceTemplates(client, null),
    );
    expect(result.current.resourceTemplates).toEqual([]);
  });

  it("updates when state dispatches resourceTemplatesChange", async () => {
    const { result } = renderHook(() =>
      usePagedResourceTemplates(client, state),
    );
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await act(async () => {
      await state.loadPage();
    });
    await waitFor(() => {
      expect(result.current.resourceTemplates.map((t) => t.name)).toEqual([
        "a",
      ]);
    });
  });

  it("loadPage proxies to the state and forwards metadata", async () => {
    client.queueResourceTemplatePages({ resourceTemplates: [template("x")] });
    const { result } = renderHook(() =>
      usePagedResourceTemplates(client, state),
    );
    let next;
    await act(async () => {
      next = await result.current.loadPage(undefined, { k: "v" });
    });
    expect(next).toEqual({
      resourceTemplates: [template("x")],
      nextCursor: undefined,
    });
    expect(client.listResourceTemplates).toHaveBeenCalledWith(undefined, {
      k: "v",
    });
  });

  it("loadPage returns empty payload when state or client is null", async () => {
    const { result } = renderHook(() => usePagedResourceTemplates(null, state));
    await expect(result.current.loadPage()).resolves.toEqual({
      resourceTemplates: [],
      nextCursor: undefined,
    });
    const { result: r2 } = renderHook(() =>
      usePagedResourceTemplates(client, null),
    );
    await expect(r2.current.loadPage()).resolves.toEqual({
      resourceTemplates: [],
      nextCursor: undefined,
    });
  });

  it("clear() proxies to the state", async () => {
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.loadPage();
    const { result } = renderHook(() =>
      usePagedResourceTemplates(client, state),
    );
    act(() => {
      result.current.clear();
    });
    await waitFor(() => {
      expect(result.current.resourceTemplates).toEqual([]);
    });
  });

  it("clear() is a no-op when state is null", () => {
    const { result } = renderHook(() =>
      usePagedResourceTemplates(client, null),
    );
    expect(() => result.current.clear()).not.toThrow();
  });

  it("resets to empty when the state prop becomes null", async () => {
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.loadPage();
    const { result, rerender } = renderHook(
      ({ s }: { s: PagedResourceTemplatesState | null }) =>
        usePagedResourceTemplates(client, s),
      { initialProps: { s: state as PagedResourceTemplatesState | null } },
    );
    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.resourceTemplates).toEqual([]);
    });
  });

  it("unsubscribes on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      usePagedResourceTemplates(client, state),
    );
    unmount();
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.loadPage();
    expect(result.current.resourceTemplates).toEqual([]);
  });
});
