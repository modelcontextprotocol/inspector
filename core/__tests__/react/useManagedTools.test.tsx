/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useManagedTools } from "../../react/useManagedTools.js";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ManagedToolsState } from "../../mcp/state/managedToolsState.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Mock ManagedToolsState: getStore(), getTools(), refresh(), setMetadata(), destroy().
 * Not typed as implements ManagedToolsState because the real class has private fields.
 */
class MockManagedToolsState {
  private store: StoreApi<{ tools: Tool[] }>;

  constructor() {
    this.store = createStore<{ tools: Tool[] }>()((_set) => ({ tools: [] }));
  }

  getStore() {
    return {
      getState: () => this.store.getState(),
      subscribe: (listener: () => void) => this.store.subscribe(listener),
    };
  }

  getTools(): Tool[] {
    return this.store.getState().tools;
  }

  setTools(tools: Tool[]): void {
    this.store.setState({ tools });
  }

  setMetadata(): void {}

  async refresh(): Promise<Tool[]> {
    return this.getTools();
  }

  destroy(): void {
    this.store.setState({ tools: [] });
  }
}

describe("useManagedTools", () => {
  it("syncs initial tools from manager store", () => {
    const manager = new MockManagedToolsState();
    manager.setTools([
      { name: "a", inputSchema: { type: "object" as const } },
      { name: "b", inputSchema: { type: "object" as const } },
    ]);

    const { result } = renderHook(() =>
      useManagedTools(manager as unknown as ManagedToolsState),
    );

    expect(result.current.tools).toHaveLength(2);
    expect(result.current.tools.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("updates tools when manager store updates", async () => {
    const manager = new MockManagedToolsState();
    manager.setTools([
      { name: "first", inputSchema: { type: "object" as const } },
    ]);

    const { result } = renderHook(() =>
      useManagedTools(manager as unknown as ManagedToolsState),
    );

    expect(result.current.tools).toHaveLength(1);
    expect(result.current.tools[0]?.name).toBe("first");

    await act(async () => {
      (manager as MockManagedToolsState).setTools([
        { name: "first", inputSchema: { type: "object" as const } },
        { name: "second", inputSchema: { type: "object" as const } },
      ]);
    });

    expect(result.current.tools).toHaveLength(2);
    expect(result.current.tools.map((t) => t.name)).toEqual([
      "first",
      "second",
    ]);
  });

  it("refresh returns tools from manager", async () => {
    const manager = new MockManagedToolsState();
    manager.setTools([{ name: "x", inputSchema: { type: "object" as const } }]);

    const { result } = renderHook(() =>
      useManagedTools(manager as unknown as ManagedToolsState),
    );

    expect(result.current.tools).toHaveLength(1);

    await act(async () => {
      (manager as MockManagedToolsState).setTools([
        { name: "x", inputSchema: { type: "object" as const } },
        { name: "y", inputSchema: { type: "object" as const } },
      ]);
    });

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toHaveLength(2);
    });

    expect(result.current.tools).toHaveLength(2);
  });
});
