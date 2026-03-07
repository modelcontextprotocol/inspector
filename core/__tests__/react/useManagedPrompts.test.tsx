/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useManagedPrompts } from "../../react/useManagedPrompts.js";
import type { ManagedPromptsState } from "../../mcp/state/managedPromptsState.js";
import type { InspectorClient } from "../../mcp/inspectorClient.js";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

/**
 * Mock ManagedPromptsState: getPrompts(), refresh(), and promptsChange events.
 */
class MockManagedPromptsState extends EventTarget {
  private _prompts: Prompt[] = [];

  getPrompts(): Prompt[] {
    return [...this._prompts];
  }

  setPrompts(prompts: Prompt[]): void {
    this._prompts = prompts;
    this.dispatchEvent(new CustomEvent("promptsChange", { detail: prompts }));
  }

  async refresh(): Promise<Prompt[]> {
    return this.getPrompts();
  }

  destroy(): void {
    this._prompts = [];
  }
}

describe("useManagedPrompts", () => {
  it("returns empty prompts and no-op refresh when given null client and null manager", async () => {
    const { result } = renderHook(() => useManagedPrompts(null, null));

    expect(result.current.prompts).toEqual([]);

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toEqual([]);
    });
    expect(result.current.prompts).toEqual([]);
  });

  it("returns empty prompts when manager is null", async () => {
    const client = {} as InspectorClient;
    const { result } = renderHook(() => useManagedPrompts(client, null));

    expect(result.current.prompts).toEqual([]);

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toEqual([]);
    });
  });

  it("syncs initial prompts from manager", () => {
    const manager = new MockManagedPromptsState();
    manager.setPrompts([
      { name: "a", arguments: [] },
      { name: "b", arguments: [] },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedPrompts(client, manager as unknown as ManagedPromptsState),
    );

    expect(result.current.prompts).toHaveLength(2);
    expect(result.current.prompts.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("updates prompts when manager dispatches promptsChange", async () => {
    const manager = new MockManagedPromptsState();
    manager.setPrompts([{ name: "first", arguments: [] }]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedPrompts(client, manager as unknown as ManagedPromptsState),
    );

    expect(result.current.prompts).toHaveLength(1);
    expect(result.current.prompts[0]?.name).toBe("first");

    await act(async () => {
      (manager as MockManagedPromptsState).setPrompts([
        { name: "first", arguments: [] },
        { name: "second", arguments: [] },
      ]);
    });

    expect(result.current.prompts).toHaveLength(2);
    expect(result.current.prompts.map((p) => p.name)).toEqual([
      "first",
      "second",
    ]);
  });

  it("refresh updates state from manager", async () => {
    const manager = new MockManagedPromptsState();
    manager.setPrompts([{ name: "x", arguments: [] }]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedPrompts(client, manager as unknown as ManagedPromptsState),
    );

    expect(result.current.prompts).toHaveLength(1);

    await act(async () => {
      (manager as MockManagedPromptsState).setPrompts([
        { name: "x", arguments: [] },
        { name: "y", arguments: [] },
      ]);
    });

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toHaveLength(2);
    });

    expect(result.current.prompts).toHaveLength(2);
  });

  it("clears prompts when manager switches to null", async () => {
    const manager = new MockManagedPromptsState();
    manager.setPrompts([{ name: "only", arguments: [] }]);
    const client = {} as InspectorClient;

    const { result, rerender } = renderHook(
      ({ client: c, manager: m }) => useManagedPrompts(c, m),
      {
        initialProps: {
          client,
          manager: manager as unknown as ManagedPromptsState,
        },
      },
    );

    expect(result.current.prompts).toHaveLength(1);

    rerender({ client, manager: null });

    expect(result.current.prompts).toEqual([]);
  });
});
