import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { ManagedToolsState } from "@inspector/core/mcp/state/managedToolsState";
import { useManagedListError } from "@inspector/core/react/useManagedListError";

// The shared subscription behind the four `useManaged*` hooks' `error` field
// (#1953). Exercised through ManagedToolsState — any managed list would do,
// since the error lives entirely in the shared base.
describe("useManagedListError", () => {
  let client: FakeInspectorClient;
  let state: ManagedToolsState;
  const boom = new Error("Invalid result for tools/list: ttlMs required");

  beforeEach(() => {
    client = new FakeInspectorClient({
      status: "connected",
      capabilities: { tools: {} },
    });
    state = new ManagedToolsState(client, 0);
  });

  it("returns null when there is no state", () => {
    const { result } = renderHook(() => useManagedListError(null));
    expect(result.current).toBeNull();
  });

  it("returns null before any load fails", () => {
    const { result } = renderHook(() => useManagedListError(state));
    expect(result.current).toBeNull();
  });

  it("seeds from an error the state already holds", async () => {
    client.listAllTools.mockRejectedValueOnce(boom);
    await expect(state.refresh()).rejects.toThrow(boom);

    const { result } = renderHook(() => useManagedListError(state));
    expect(result.current).toBe(boom);
  });

  it("updates when the state dispatches errorChange", async () => {
    const { result } = renderHook(() => useManagedListError(state));

    client.listAllTools.mockRejectedValueOnce(boom);
    await act(async () => {
      await expect(state.refresh()).rejects.toThrow(boom);
    });
    expect(result.current).toBe(boom);
  });

  it("clears when a later load succeeds", async () => {
    client.listAllTools.mockRejectedValueOnce(boom);
    await expect(state.refresh()).rejects.toThrow(boom);
    const { result } = renderHook(() => useManagedListError(state));
    expect(result.current).toBe(boom);

    await act(async () => {
      await state.refresh();
    });
    expect(result.current).toBeNull();
  });

  it("resets to null when the state becomes null", async () => {
    client.listAllTools.mockRejectedValueOnce(boom);
    await expect(state.refresh()).rejects.toThrow(boom);

    const { result, rerender } = renderHook(
      ({ s }: { s: ManagedToolsState | null }) => useManagedListError(s),
      { initialProps: { s: state as ManagedToolsState | null } },
    );
    expect(result.current).toBe(boom);

    rerender({ s: null });
    expect(result.current).toBeNull();
  });

  it("unsubscribes on unmount", async () => {
    const { unmount } = renderHook(() => useManagedListError(state));
    unmount();

    client.listAllTools.mockRejectedValueOnce(boom);
    // No act() wrapper: a listener still attached would warn about an update
    // outside act, and the assertion below would be the only other signal.
    await expect(state.refresh()).rejects.toThrow(boom);
    expect(state.getError()).toBe(boom);
  });
});
