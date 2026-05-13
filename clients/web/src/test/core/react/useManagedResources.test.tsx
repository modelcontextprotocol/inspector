import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { ManagedResourcesState } from "@inspector/core/mcp/state/managedResourcesState";
import { useManagedResources } from "@inspector/core/react/useManagedResources";

function resource(uri: string): Resource {
  return { uri, name: uri };
}

describe("useManagedResources", () => {
  let client: FakeInspectorClient;
  let state: ManagedResourcesState;

  beforeEach(() => {
    client = new FakeInspectorClient({ status: "connected" });
    state = new ManagedResourcesState(client);
  });

  it("returns the initial resources snapshot from the state", async () => {
    client.queueResourcePages({
      resources: [resource("a://1"), resource("a://2")],
    });
    await state.refresh();

    const { result } = renderHook(() => useManagedResources(client, state));
    expect(result.current.resources.map((r) => r.uri)).toEqual([
      "a://1",
      "a://2",
    ]);
  });

  it("returns empty resources when state is null", () => {
    const { result } = renderHook(() => useManagedResources(client, null));
    expect(result.current.resources).toEqual([]);
  });

  it("updates when state dispatches resourcesChange", async () => {
    const { result } = renderHook(() => useManagedResources(client, state));
    expect(result.current.resources).toEqual([]);

    client.queueResourcePages({ resources: [resource("a://1")] });
    await act(async () => {
      await state.refresh();
    });

    await waitFor(() => {
      expect(result.current.resources.map((r) => r.uri)).toEqual(["a://1"]);
    });
  });

  it("refresh() calls through to state and returns the next resources", async () => {
    client.queueResourcePages({ resources: [resource("x://1")] });
    const { result } = renderHook(() => useManagedResources(client, state));

    let next: Resource[] = [];
    await act(async () => {
      next = await result.current.refresh();
    });

    expect(next.map((r) => r.uri)).toEqual(["x://1"]);
    expect(result.current.resources.map((r) => r.uri)).toEqual(["x://1"]);
  });

  it("refresh() returns [] when state or client is null", async () => {
    const { result } = renderHook(() => useManagedResources(null, state));
    await expect(result.current.refresh()).resolves.toEqual([]);

    const { result: result2 } = renderHook(() =>
      useManagedResources(client, null),
    );
    await expect(result2.current.refresh()).resolves.toEqual([]);
  });

  it("resets to empty resources when the state prop becomes null", async () => {
    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.refresh();

    const { result, rerender } = renderHook(
      ({ s }: { s: ManagedResourcesState | null }) =>
        useManagedResources(client, s),
      { initialProps: { s: state as ManagedResourcesState | null } },
    );
    await waitFor(() => {
      expect(result.current.resources.map((r) => r.uri)).toEqual(["a://1"]);
    });

    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.resources).toEqual([]);
    });
  });

  it("unsubscribes from the state on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useManagedResources(client, state),
    );

    unmount();

    client.queueResourcePages({ resources: [resource("a://1")] });
    await state.refresh();

    expect(result.current.resources).toEqual([]);
  });
});
