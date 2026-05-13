import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { PagedPromptsState } from "@inspector/core/mcp/state/pagedPromptsState";
import { usePagedPrompts } from "@inspector/core/react/usePagedPrompts";

function prompt(name: string): Prompt {
  return { name };
}

describe("usePagedPrompts", () => {
  let client: FakeInspectorClient;
  let state: PagedPromptsState;

  beforeEach(() => {
    client = new FakeInspectorClient({ status: "connected" });
    state = new PagedPromptsState(client);
  });

  it("returns the initial snapshot from the state", async () => {
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.loadPage();
    const { result } = renderHook(() => usePagedPrompts(client, state));
    expect(result.current.prompts.map((p) => p.name)).toEqual(["a"]);
  });

  it("returns empty when state is null", () => {
    const { result } = renderHook(() => usePagedPrompts(client, null));
    expect(result.current.prompts).toEqual([]);
  });

  it("updates when state dispatches promptsChange", async () => {
    const { result } = renderHook(() => usePagedPrompts(client, state));
    client.queuePromptPages({ prompts: [prompt("a")] });
    await act(async () => {
      await state.loadPage();
    });
    await waitFor(() => {
      expect(result.current.prompts.map((p) => p.name)).toEqual(["a"]);
    });
  });

  it("loadPage proxies to the state and forwards metadata", async () => {
    client.queuePromptPages({ prompts: [prompt("x")] });
    const { result } = renderHook(() => usePagedPrompts(client, state));
    let next;
    await act(async () => {
      next = await result.current.loadPage(undefined, { k: "v" });
    });
    expect(next).toEqual({ prompts: [prompt("x")], nextCursor: undefined });
    expect(client.listPrompts).toHaveBeenCalledWith(undefined, { k: "v" });
  });

  it("loadPage returns empty payload when state or client is null", async () => {
    const { result } = renderHook(() => usePagedPrompts(null, state));
    await expect(result.current.loadPage()).resolves.toEqual({
      prompts: [],
      nextCursor: undefined,
    });
    const { result: r2 } = renderHook(() => usePagedPrompts(client, null));
    await expect(r2.current.loadPage()).resolves.toEqual({
      prompts: [],
      nextCursor: undefined,
    });
  });

  it("clear() proxies to the state", async () => {
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.loadPage();
    const { result } = renderHook(() => usePagedPrompts(client, state));
    act(() => {
      result.current.clear();
    });
    await waitFor(() => {
      expect(result.current.prompts).toEqual([]);
    });
  });

  it("clear() is a no-op when state is null", () => {
    const { result } = renderHook(() => usePagedPrompts(client, null));
    expect(() => result.current.clear()).not.toThrow();
  });

  it("resets to empty when the state prop becomes null", async () => {
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.loadPage();
    const { result, rerender } = renderHook(
      ({ s }: { s: PagedPromptsState | null }) => usePagedPrompts(client, s),
      { initialProps: { s: state as PagedPromptsState | null } },
    );
    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.prompts).toEqual([]);
    });
  });

  it("unsubscribes on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      usePagedPrompts(client, state),
    );
    unmount();
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.loadPage();
    expect(result.current.prompts).toEqual([]);
  });
});
