/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useManagedTools } from "../../react/useManagedTools.js";
import type { ManagedToolsState } from "../../mcp/state/managedToolsState.js";
import type { InspectorClient } from "../../mcp/inspectorClient.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Mock ManagedToolsState: getTools(), refresh(), and toolsChange events.
 */
class MockManagedToolsState extends EventTarget {
  private _tools: Tool[] = [];

  getTools(): Tool[] {
    return [...this._tools];
  }

  setTools(tools: Tool[]): void {
    this._tools = tools;
    this.dispatchEvent(new CustomEvent("toolsChange", { detail: tools }));
  }

  async refresh(): Promise<Tool[]> {
    return this.getTools();
  }

  destroy(): void {
    this._tools = [];
  }
}

describe("useManagedTools", () => {
  it("returns empty tools and no-op refresh when given null client and null manager", async () => {
    const { result } = renderHook(() => useManagedTools(null, null));

    expect(result.current.tools).toEqual([]);

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toEqual([]);
    });
    expect(result.current.tools).toEqual([]);
  });

  it("returns empty tools when manager is null", async () => {
    const client = {} as InspectorClient;
    const { result } = renderHook(() => useManagedTools(client, null));

    expect(result.current.tools).toEqual([]);

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toEqual([]);
    });
  });

  it("syncs initial tools from manager", () => {
    const manager = new MockManagedToolsState();
    manager.setTools([
      { name: "a", inputSchema: { type: "object" as const } },
      { name: "b", inputSchema: { type: "object" as const } },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedTools(client, manager as unknown as ManagedToolsState),
    );

    expect(result.current.tools).toHaveLength(2);
    expect(result.current.tools.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("updates tools when manager dispatches toolsChange", async () => {
    const manager = new MockManagedToolsState();
    manager.setTools([
      { name: "first", inputSchema: { type: "object" as const } },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedTools(client, manager as unknown as ManagedToolsState),
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

  it("refresh updates state from manager", async () => {
    const manager = new MockManagedToolsState();
    manager.setTools([{ name: "x", inputSchema: { type: "object" as const } }]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedTools(client, manager as unknown as ManagedToolsState),
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

  it("clears tools when manager switches to null", async () => {
    const manager = new MockManagedToolsState();
    manager.setTools([
      { name: "only", inputSchema: { type: "object" as const } },
    ]);
    const client = {} as InspectorClient;

    const { result, rerender } = renderHook(
      ({ client: c, manager: m }) => useManagedTools(c, m),
      {
        initialProps: {
          client,
          manager: manager as unknown as ManagedToolsState,
        },
      },
    );

    expect(result.current.tools).toHaveLength(1);

    rerender({ client, manager: null });

    expect(result.current.tools).toEqual([]);
  });
});
