import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { ResourceSubscriptionsState } from "@inspector/core/mcp/state/resourceSubscriptionsState";
import { useResourceSubscriptions } from "@inspector/core/react/useResourceSubscriptions";

describe("useResourceSubscriptions", () => {
  let client: FakeInspectorClient;
  let state: ResourceSubscriptionsState;

  beforeEach(() => {
    client = new FakeInspectorClient({ status: "connected" });
    state = new ResourceSubscriptionsState(client);
  });

  it("returns the initial snapshot from the state", () => {
    client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    const { result } = renderHook(() => useResourceSubscriptions(state));
    expect(result.current.subscriptions.map((s) => s.resource.uri)).toEqual([
      "file:///a",
    ]);
  });

  it("returns empty subscriptions when state is null", () => {
    const { result } = renderHook(() => useResourceSubscriptions(null));
    expect(result.current.subscriptions).toEqual([]);
  });

  it("updates when state dispatches subscriptionsChange", async () => {
    const { result } = renderHook(() => useResourceSubscriptions(state));
    expect(result.current.subscriptions).toEqual([]);

    act(() => {
      client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    });

    await waitFor(() => {
      expect(result.current.subscriptions.map((s) => s.resource.uri)).toEqual([
        "file:///a",
      ]);
    });
  });

  it("resets to empty when the state prop becomes null", async () => {
    client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    const { result, rerender } = renderHook(
      ({ s }: { s: ResourceSubscriptionsState | null }) =>
        useResourceSubscriptions(s),
      { initialProps: { s: state as ResourceSubscriptionsState | null } },
    );
    await waitFor(() => {
      expect(result.current.subscriptions).toHaveLength(1);
    });

    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.subscriptions).toEqual([]);
    });
  });

  it("unsubscribes from the state on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useResourceSubscriptions(state),
    );
    unmount();
    client.dispatchTypedEvent("resourceSubscriptionsChange", ["file:///a"]);
    expect(result.current.subscriptions).toEqual([]);
  });
});
