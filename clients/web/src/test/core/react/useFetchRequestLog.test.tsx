import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { FetchRequestEntry } from "@inspector/core/mcp/types";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { FetchRequestLogState } from "@inspector/core/mcp/state/fetchRequestLogState";
import { useFetchRequestLog } from "@inspector/core/react/useFetchRequestLog";

function entry(id: string): FetchRequestEntry {
  return {
    id,
    timestamp: new Date(2026, 4, 13),
    method: "GET",
    url: `https://x/${id}`,
    requestHeaders: {},
    category: "transport",
  };
}

describe("useFetchRequestLog", () => {
  let client: FakeInspectorClient;
  let state: FetchRequestLogState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new FetchRequestLogState(client);
  });

  it("returns the initial snapshot from the state", () => {
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    const { result } = renderHook(() => useFetchRequestLog(state));
    expect(result.current.fetchRequests.map((e) => e.id)).toEqual(["a"]);
  });

  it("returns empty when state is null", () => {
    const { result } = renderHook(() => useFetchRequestLog(null));
    expect(result.current.fetchRequests).toEqual([]);
  });

  it("updates when state dispatches fetchRequestsChange", async () => {
    const { result } = renderHook(() => useFetchRequestLog(state));
    act(() => {
      client.dispatchTypedEvent("fetchRequest", entry("a"));
    });
    await waitFor(() => {
      expect(result.current.fetchRequests).toHaveLength(1);
    });
  });

  it("resets to empty when the state prop becomes null", async () => {
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    const { result, rerender } = renderHook(
      ({ s }: { s: FetchRequestLogState | null }) => useFetchRequestLog(s),
      { initialProps: { s: state as FetchRequestLogState | null } },
    );
    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.fetchRequests).toEqual([]);
    });
  });

  it("unsubscribes on unmount", () => {
    const { result, unmount } = renderHook(() => useFetchRequestLog(state));
    unmount();
    client.dispatchTypedEvent("fetchRequest", entry("a"));
    expect(result.current.fetchRequests).toEqual([]);
  });
});
