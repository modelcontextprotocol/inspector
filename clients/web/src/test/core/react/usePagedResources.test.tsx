import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { PagedResourcesState } from "@inspector/core/mcp/state/pagedResourcesState";
import { usePagedResources } from "@inspector/core/react/usePagedResources";

function resource(uri: string): Resource {
  return { uri, name: uri };
}

describe("usePagedResources", () => {
  let client: FakeInspectorClient;
  let state: PagedResourcesState;

  beforeEach(() => {
    client = new FakeInspectorClient({ status: "connected" });
    state = new PagedResourcesState(client);
  });

  it("returns the initial snapshot from the state", async () => {
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.loadPage();
    const { result } = renderHook(() => usePagedResources(client, state));
    expect(result.current.resources.map((r) => r.uri)).toEqual(["a://1"]);
  });

  it("returns empty when state is null", () => {
    const { result } = renderHook(() => usePagedResources(client, null));
    expect(result.current.resources).toEqual([]);
  });

  it("updates when state dispatches resourcesChange", async () => {
    const { result } = renderHook(() => usePagedResources(client, state));
    client.queueResourcePages({ resources: [resource("a://1")] });
    await act(async () => {
      await state.loadPage();
    });
    await waitFor(() => {
      expect(result.current.resources.map((r) => r.uri)).toEqual(["a://1"]);
    });
  });

  it("loadPage proxies to the state and forwards metadata", async () => {
    client.queueResourcePages({ resources: [resource("x://1")] });
    const { result } = renderHook(() => usePagedResources(client, state));
    let next;
    await act(async () => {
      next = await result.current.loadPage(undefined, { k: "v" });
    });
    expect(next).toEqual({
      resources: [resource("x://1")],
      nextCursor: undefined,
    });
    expect(client.listResources).toHaveBeenCalledWith(undefined, { k: "v" });
  });

  it("loadPage returns empty payload when state or client is null", async () => {
    const { result } = renderHook(() => usePagedResources(null, state));
    await expect(result.current.loadPage()).resolves.toEqual({
      resources: [],
      nextCursor: undefined,
    });
    const { result: r2 } = renderHook(() => usePagedResources(client, null));
    await expect(r2.current.loadPage()).resolves.toEqual({
      resources: [],
      nextCursor: undefined,
    });
  });

  it("clear() proxies to the state", async () => {
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.loadPage();
    const { result } = renderHook(() => usePagedResources(client, state));
    act(() => {
      result.current.clear();
    });
    await waitFor(() => {
      expect(result.current.resources).toEqual([]);
    });
  });

  it("clear() is a no-op when state is null", () => {
    const { result } = renderHook(() => usePagedResources(client, null));
    expect(() => result.current.clear()).not.toThrow();
  });

  it("resets to empty when the state prop becomes null", async () => {
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.loadPage();
    const { result, rerender } = renderHook(
      ({ s }: { s: PagedResourcesState | null }) =>
        usePagedResources(client, s),
      { initialProps: { s: state as PagedResourcesState | null } },
    );
    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.resources).toEqual([]);
    });
  });

  it("unsubscribes on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      usePagedResources(client, state),
    );
    unmount();
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.loadPage();
    expect(result.current.resources).toEqual([]);
  });
});
