import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Prompt } from "@modelcontextprotocol/client";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { ManagedPromptsState } from "@inspector/core/mcp/state/managedPromptsState";
import { useManagedPrompts } from "@inspector/core/react/useManagedPrompts";

function prompt(name: string): Prompt {
  return { name };
}

describe("useManagedPrompts", () => {
  let client: FakeInspectorClient;
  let state: ManagedPromptsState;

  beforeEach(() => {
    client = new FakeInspectorClient({
      status: "connected",
      capabilities: { prompts: {} },
    });
    state = new ManagedPromptsState(client, 0);
  });

  it("returns the initial prompts snapshot from the state", async () => {
    client.queuePromptPages({ prompts: [prompt("a"), prompt("b")] });
    await state.refresh();

    const { result } = renderHook(() => useManagedPrompts(client, state));
    expect(result.current.prompts.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("returns empty prompts when state is null", () => {
    const { result } = renderHook(() => useManagedPrompts(client, null));
    expect(result.current.prompts).toEqual([]);
  });

  it("updates when state dispatches promptsChange", async () => {
    const { result } = renderHook(() => useManagedPrompts(client, state));
    expect(result.current.prompts).toEqual([]);

    client.queuePromptPages({ prompts: [prompt("a")] });
    await act(async () => {
      await state.refresh();
    });

    await waitFor(() => {
      expect(result.current.prompts.map((p) => p.name)).toEqual(["a"]);
    });
  });

  it("refresh() calls through to state and returns the next prompts", async () => {
    client.queuePromptPages({ prompts: [prompt("x")] });
    const { result } = renderHook(() => useManagedPrompts(client, state));

    let next: Prompt[] = [];
    await act(async () => {
      next = await result.current.refresh();
    });

    expect(next.map((p) => p.name)).toEqual(["x"]);
    expect(result.current.prompts.map((p) => p.name)).toEqual(["x"]);
  });

  it("refresh() returns [] when state or client is null", async () => {
    const { result } = renderHook(() => useManagedPrompts(null, state));
    await expect(result.current.refresh()).resolves.toEqual([]);

    const { result: result2 } = renderHook(() =>
      useManagedPrompts(client, null),
    );
    await expect(result2.current.refresh()).resolves.toEqual([]);
  });

  it("resets to empty prompts when the state prop becomes null", async () => {
    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.refresh();

    const { result, rerender } = renderHook(
      ({ s }: { s: ManagedPromptsState | null }) =>
        useManagedPrompts(client, s),
      { initialProps: { s: state as ManagedPromptsState | null } },
    );
    await waitFor(() => {
      expect(result.current.prompts.map((p) => p.name)).toEqual(["a"]);
    });

    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.prompts).toEqual([]);
    });
  });

  it("unsubscribes from the state on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useManagedPrompts(client, state),
    );

    unmount();

    client.queuePromptPages({ prompts: [prompt("a")] });
    await state.refresh();

    expect(result.current.prompts).toEqual([]);
  });

  describe("listChanged (#1402)", () => {
    it("starts false and reflects listChangedChange from the state", async () => {
      const { result } = renderHook(() => useManagedPrompts(client, state));
      expect(result.current.listChanged).toBe(false);

      client.queuePromptPages({ prompts: [prompt("a")] });
      act(() => {
        client.dispatchTypedEvent("promptsListChanged");
      });
      await waitFor(() => {
        expect(result.current.listChanged).toBe(true);
      });
    });

    it("refresh() clears the indicator", async () => {
      const { result } = renderHook(() => useManagedPrompts(client, state));
      client.queuePromptPages({ prompts: [prompt("a")] });
      act(() => {
        client.dispatchTypedEvent("promptsListChanged");
      });
      await waitFor(() => expect(result.current.listChanged).toBe(true));

      client.queuePromptPages({ prompts: [prompt("a")] });
      await act(async () => {
        await result.current.refresh();
      });
      await waitFor(() => {
        expect(result.current.listChanged).toBe(false);
      });
    });

    it("defaults to false when state is null", () => {
      const { result } = renderHook(() => useManagedPrompts(client, null));
      expect(result.current.listChanged).toBe(false);
    });

    it("clearListChanged() acknowledges the indicator without fetching (#1721)", async () => {
      const { result } = renderHook(() => useManagedPrompts(client, state));
      act(() => {
        client.dispatchTypedEvent("promptsListChanged");
      });
      await waitFor(() => expect(result.current.listChanged).toBe(true));
      act(() => {
        result.current.clearListChanged();
      });
      await waitFor(() => expect(result.current.listChanged).toBe(false));
      expect(client.listAllPrompts).not.toHaveBeenCalled();
    });

    it("clearListChanged() is a no-op when state is null", () => {
      const { result } = renderHook(() => useManagedPrompts(client, null));
      expect(() => result.current.clearListChanged()).not.toThrow();
    });
  });
});
