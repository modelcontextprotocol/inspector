import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { ManagedToolsState } from "@inspector/core/mcp/state/managedToolsState";
import { useManagedTools } from "@inspector/core/react/useManagedTools";

function tool(name: string): Tool {
  return { name, inputSchema: { type: "object" } };
}

describe("useManagedTools", () => {
  let client: FakeInspectorClient;
  let state: ManagedToolsState;

  beforeEach(() => {
    client = new FakeInspectorClient({
      status: "connected",
      capabilities: { tools: {} },
    });
    state = new ManagedToolsState(client);
  });

  it("returns the initial tools snapshot from the state", async () => {
    client.queueToolPages({ tools: [tool("a"), tool("b")] });
    await state.refresh();

    const { result } = renderHook(() => useManagedTools(client, state));
    expect(result.current.tools.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("returns empty tools when state is null", () => {
    const { result } = renderHook(() => useManagedTools(client, null));
    expect(result.current.tools).toEqual([]);
  });

  it("updates when state dispatches toolsChange", async () => {
    const { result } = renderHook(() => useManagedTools(client, state));
    expect(result.current.tools).toEqual([]);

    client.queueToolPages({ tools: [tool("a")] });
    await act(async () => {
      await state.refresh();
    });

    await waitFor(() => {
      expect(result.current.tools.map((t) => t.name)).toEqual(["a"]);
    });
  });

  it("refresh() calls through to state and returns the next tools", async () => {
    client.queueToolPages({ tools: [tool("x")] });
    const { result } = renderHook(() => useManagedTools(client, state));

    let next: Tool[] = [];
    await act(async () => {
      next = await result.current.refresh();
    });

    expect(next.map((t) => t.name)).toEqual(["x"]);
    expect(result.current.tools.map((t) => t.name)).toEqual(["x"]);
  });

  it("refresh() returns [] when state or client is null", async () => {
    const { result } = renderHook(() => useManagedTools(null, state));
    await expect(result.current.refresh()).resolves.toEqual([]);

    const { result: result2 } = renderHook(() => useManagedTools(client, null));
    await expect(result2.current.refresh()).resolves.toEqual([]);
  });

  it("resets to empty tools when the state prop becomes null", async () => {
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();

    const { result, rerender } = renderHook(
      ({ s }: { s: ManagedToolsState | null }) => useManagedTools(client, s),
      { initialProps: { s: state as ManagedToolsState | null } },
    );
    await waitFor(() => {
      expect(result.current.tools.map((t) => t.name)).toEqual(["a"]);
    });

    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.tools).toEqual([]);
    });
  });

  it("unsubscribes from the state on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useManagedTools(client, state),
    );

    unmount();

    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();

    // After unmount the hook should not be receiving updates — the last
    // observed value is the empty snapshot captured before the refresh.
    expect(result.current.tools).toEqual([]);
  });

  describe("listChanged (#1402)", () => {
    it("starts false and reflects listChangedChange from the state", async () => {
      const { result } = renderHook(() => useManagedTools(client, state));
      expect(result.current.listChanged).toBe(false);

      client.queueToolPages({ tools: [tool("a")] });
      act(() => {
        client.dispatchTypedEvent("toolsListChanged");
      });
      await waitFor(() => {
        expect(result.current.listChanged).toBe(true);
      });
    });

    it("refresh() clears the indicator", async () => {
      const { result } = renderHook(() => useManagedTools(client, state));
      client.queueToolPages({ tools: [tool("a")] });
      act(() => {
        client.dispatchTypedEvent("toolsListChanged");
      });
      await waitFor(() => expect(result.current.listChanged).toBe(true));

      client.queueToolPages({ tools: [tool("a")] });
      await act(async () => {
        await result.current.refresh();
      });
      await waitFor(() => {
        expect(result.current.listChanged).toBe(false);
      });
    });

    it("defaults to false when state is null", () => {
      const { result } = renderHook(() => useManagedTools(client, null));
      expect(result.current.listChanged).toBe(false);
    });

    it("keeps a change that fires during the awaited refresh (race regression)", async () => {
      const { result } = renderHook(() => useManagedTools(client, state));

      // Indicator starts set from an initial change.
      client.queueToolPages({ tools: [tool("a")] });
      act(() => {
        client.dispatchTypedEvent("toolsListChanged");
      });
      await waitFor(() => expect(result.current.listChanged).toBe(true));

      // Hang the user-refresh's fetch so a new change can land mid-flight.
      let releaseRefresh: (value: { tools: Tool[] }) => void = () => {};
      client.listTools.mockImplementationOnce(
        () =>
          new Promise<{ tools: Tool[] }>((resolve) => {
            releaseRefresh = resolve;
          }),
      );

      let refreshPromise!: Promise<Tool[]>;
      act(() => {
        refreshPromise = result.current.refresh();
      });
      // The hook clears BEFORE awaiting, so the indicator is already off.
      await waitFor(() => expect(result.current.listChanged).toBe(false));

      // A genuinely-new change arrives while the refresh is still in flight.
      client.queueToolPages({ tools: [tool("a"), tool("b")] });
      act(() => {
        client.dispatchTypedEvent("toolsListChanged");
      });
      await waitFor(() => expect(result.current.listChanged).toBe(true));

      // Completing the user refresh must NOT wipe the mid-flight change.
      await act(async () => {
        releaseRefresh({ tools: [tool("a")] });
        await refreshPromise;
      });
      expect(result.current.listChanged).toBe(true);
    });
  });
});
