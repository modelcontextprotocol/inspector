/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagedTools } from "../../react/usePagedTools.js";
import type { PagedToolsState } from "../../mcp/state/pagedToolsState.js";
import type { InspectorClient } from "../../mcp/inspectorClient.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Mock PagedToolsState: getTools(), loadPage(), and toolsChange events.
 */
class MockPagedToolsState extends EventTarget {
  private _tools: Tool[] = [];

  getTools(): Tool[] {
    return [...this._tools];
  }

  appendTools(tools: Tool[]): void {
    this._tools = [...this._tools, ...tools];
    this.dispatchEvent(new CustomEvent("toolsChange", { detail: this._tools }));
  }

  async loadPage(_cursor?: string): Promise<{
    tools: Tool[];
    nextCursor?: string;
  }> {
    return { tools: this._tools, nextCursor: undefined };
  }

  /** Test helper: simulate loading a page that adds tools. */
  simulateLoadPage(tools: Tool[], _nextCursor?: string): void {
    this._tools = [...this._tools, ...tools];
    this.dispatchEvent(new CustomEvent("toolsChange", { detail: this._tools }));
  }

  clear(): void {
    this._tools = [];
    this.dispatchEvent(new CustomEvent("toolsChange", { detail: this._tools }));
  }

  destroy(): void {
    this._tools = [];
  }
}

describe("usePagedTools", () => {
  it("returns empty tools, no-op loadPage, and no-op clear when given null client and null manager", async () => {
    const { result } = renderHook(() => usePagedTools(null, null));

    expect(result.current.tools).toEqual([]);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.tools).toEqual([]);
      expect(page.nextCursor).toBeUndefined();
    });
    expect(result.current.tools).toEqual([]);

    act(() => {
      result.current.clear();
    });
    expect(result.current.tools).toEqual([]);
  });

  it("returns empty tools when manager is null", async () => {
    const client = {} as InspectorClient;
    const { result } = renderHook(() => usePagedTools(client, null));

    expect(result.current.tools).toEqual([]);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.tools).toEqual([]);
    });
  });

  it("syncs initial tools from manager", () => {
    const manager = new MockPagedToolsState();
    manager.appendTools([
      { name: "a", inputSchema: { type: "object" as const } },
      { name: "b", inputSchema: { type: "object" as const } },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedTools(client, manager as unknown as PagedToolsState),
    );

    expect(result.current.tools).toHaveLength(2);
    expect(result.current.tools.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("updates tools when manager dispatches toolsChange", async () => {
    const manager = new MockPagedToolsState();
    manager.appendTools([
      { name: "first", inputSchema: { type: "object" as const } },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedTools(client, manager as unknown as PagedToolsState),
    );

    expect(result.current.tools).toHaveLength(1);
    expect(result.current.tools[0]?.name).toBe("first");

    await act(async () => {
      (manager as MockPagedToolsState).simulateLoadPage([
        { name: "second", inputSchema: { type: "object" as const } },
      ]);
    });

    expect(result.current.tools).toHaveLength(2);
    expect(result.current.tools.map((t) => t.name)).toEqual([
      "first",
      "second",
    ]);
  });

  it("loadPage updates state from manager", async () => {
    const manager = new MockPagedToolsState();
    const client = {} as InspectorClient;
    // Mock loadPage to add tools when called
    (manager as MockPagedToolsState).loadPage = async function (
      _cursor?: string,
    ) {
      this.simulateLoadPage([
        { name: "x", inputSchema: { type: "object" as const } },
        { name: "y", inputSchema: { type: "object" as const } },
      ]);
      return {
        tools: [
          { name: "x", inputSchema: { type: "object" as const } },
          { name: "y", inputSchema: { type: "object" as const } },
        ],
        nextCursor: undefined,
      };
    };

    const { result } = renderHook(() =>
      usePagedTools(client, manager as unknown as PagedToolsState),
    );

    expect(result.current.tools).toHaveLength(0);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.tools).toHaveLength(2);
    });

    expect(result.current.tools).toHaveLength(2);
    expect(result.current.tools.map((t) => t.name)).toEqual(["x", "y"]);
  });

  it("clear empties tools", async () => {
    const manager = new MockPagedToolsState();
    manager.appendTools([
      { name: "a", inputSchema: { type: "object" as const } },
      { name: "b", inputSchema: { type: "object" as const } },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedTools(client, manager as unknown as PagedToolsState),
    );

    expect(result.current.tools).toHaveLength(2);

    act(() => {
      result.current.clear();
    });

    expect(result.current.tools).toEqual([]);
  });

  it("clears tools when manager switches to null", async () => {
    const manager = new MockPagedToolsState();
    manager.appendTools([
      { name: "only", inputSchema: { type: "object" as const } },
    ]);
    const client = {} as InspectorClient;

    type Props = {
      client: InspectorClient | null;
      manager: PagedToolsState | null;
    };
    const { result, rerender } = renderHook(
      ({ client: c, manager: m }: Props) => usePagedTools(c, m),
      {
        initialProps: {
          client,
          manager: manager as unknown as PagedToolsState,
        } as Props,
      },
    );

    expect(result.current.tools).toHaveLength(1);

    rerender({ client, manager: null });

    expect(result.current.tools).toEqual([]);
  });
});
