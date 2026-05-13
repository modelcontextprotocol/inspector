import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { PagedToolsState } from "@inspector/core/mcp/state/pagedToolsState";
import { usePagedTools } from "@inspector/core/react/usePagedTools";

function tool(name: string): Tool {
  return { name, inputSchema: { type: "object" } };
}

describe("usePagedTools", () => {
  let client: FakeInspectorClient;
  let state: PagedToolsState;

  beforeEach(() => {
    client = new FakeInspectorClient({ status: "connected" });
    state = new PagedToolsState(client);
  });

  it("returns the initial snapshot from the state", async () => {
    client.queueToolPages({ tools: [tool("a")] });
    await state.loadPage();
    const { result } = renderHook(() => usePagedTools(client, state));
    expect(result.current.tools.map((t) => t.name)).toEqual(["a"]);
  });

  it("returns empty when state is null", () => {
    const { result } = renderHook(() => usePagedTools(client, null));
    expect(result.current.tools).toEqual([]);
  });

  it("updates when state dispatches toolsChange", async () => {
    const { result } = renderHook(() => usePagedTools(client, state));
    client.queueToolPages({ tools: [tool("a")] });
    await act(async () => {
      await state.loadPage();
    });
    await waitFor(() => {
      expect(result.current.tools.map((t) => t.name)).toEqual(["a"]);
    });
  });

  it("loadPage proxies to the state and returns the result", async () => {
    client.queueToolPages({ tools: [tool("x")], nextCursor: "c1" });
    const { result } = renderHook(() => usePagedTools(client, state));
    let next;
    await act(async () => {
      next = await result.current.loadPage();
    });
    expect(next).toEqual({ tools: [tool("x")], nextCursor: "c1" });
    expect(result.current.tools.map((t) => t.name)).toEqual(["x"]);
  });

  it("loadPage returns empty payload when state or client is null", async () => {
    const { result } = renderHook(() => usePagedTools(null, state));
    await expect(result.current.loadPage()).resolves.toEqual({
      tools: [],
      nextCursor: undefined,
    });

    const { result: r2 } = renderHook(() => usePagedTools(client, null));
    await expect(r2.current.loadPage()).resolves.toEqual({
      tools: [],
      nextCursor: undefined,
    });
  });

  it("clear() proxies to the state", async () => {
    client.queueToolPages({ tools: [tool("a")] });
    await state.loadPage();
    const { result } = renderHook(() => usePagedTools(client, state));
    act(() => {
      result.current.clear();
    });
    await waitFor(() => {
      expect(result.current.tools).toEqual([]);
    });
  });

  it("clear() is a no-op when state is null", () => {
    const { result } = renderHook(() => usePagedTools(client, null));
    expect(() => result.current.clear()).not.toThrow();
  });

  it("resets to empty when the state prop becomes null", async () => {
    client.queueToolPages({ tools: [tool("a")] });
    await state.loadPage();
    const { result, rerender } = renderHook(
      ({ s }: { s: PagedToolsState | null }) => usePagedTools(client, s),
      { initialProps: { s: state as PagedToolsState | null } },
    );
    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.tools).toEqual([]);
    });
  });

  it("unsubscribes on unmount", async () => {
    const { result, unmount } = renderHook(() => usePagedTools(client, state));
    unmount();
    client.queueToolPages({ tools: [tool("a")] });
    await state.loadPage();
    expect(result.current.tools).toEqual([]);
  });
});
