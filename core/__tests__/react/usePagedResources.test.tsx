/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagedResources } from "../../react/usePagedResources.js";
import type { PagedResourcesState } from "../../mcp/state/pagedResourcesState.js";
import type { InspectorClient } from "../../mcp/inspectorClient.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";

/**
 * Mock PagedResourcesState: getResources(), loadPage(), and resourcesChange events.
 */
class MockPagedResourcesState extends EventTarget {
  private _resources: Resource[] = [];

  getResources(): Resource[] {
    return [...this._resources];
  }

  appendResources(resources: Resource[]): void {
    this._resources = [...this._resources, ...resources];
    this.dispatchEvent(
      new CustomEvent("resourcesChange", { detail: this._resources }),
    );
  }

  async loadPage(_cursor?: string): Promise<{
    resources: Resource[];
    nextCursor?: string;
  }> {
    return { resources: this._resources, nextCursor: undefined };
  }

  simulateLoadPage(resources: Resource[], _nextCursor?: string): void {
    this._resources = [...this._resources, ...resources];
    this.dispatchEvent(
      new CustomEvent("resourcesChange", { detail: this._resources }),
    );
  }

  clear(): void {
    this._resources = [];
    this.dispatchEvent(
      new CustomEvent("resourcesChange", { detail: this._resources }),
    );
  }

  destroy(): void {
    this._resources = [];
  }
}

describe("usePagedResources", () => {
  it("returns empty resources, no-op loadPage, and no-op clear when given null client and null manager", async () => {
    const { result } = renderHook(() => usePagedResources(null, null));

    expect(result.current.resources).toEqual([]);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.resources).toEqual([]);
      expect(page.nextCursor).toBeUndefined();
    });
    expect(result.current.resources).toEqual([]);

    act(() => {
      result.current.clear();
    });
    expect(result.current.resources).toEqual([]);
  });

  it("returns empty resources when manager is null", async () => {
    const client = {} as InspectorClient;
    const { result } = renderHook(() => usePagedResources(client, null));

    expect(result.current.resources).toEqual([]);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.resources).toEqual([]);
    });
  });

  it("syncs initial resources from manager", () => {
    const manager = new MockPagedResourcesState();
    manager.appendResources([
      { uri: "a", name: "A", mimeType: "text/plain" },
      { uri: "b", name: "B", mimeType: "text/plain" },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedResources(client, manager as unknown as PagedResourcesState),
    );

    expect(result.current.resources).toHaveLength(2);
    expect(result.current.resources.map((r) => r.uri)).toEqual(["a", "b"]);
  });

  it("updates resources when manager dispatches resourcesChange", async () => {
    const manager = new MockPagedResourcesState();
    manager.appendResources([
      { uri: "first", name: "First", mimeType: "text/plain" },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedResources(client, manager as unknown as PagedResourcesState),
    );

    expect(result.current.resources).toHaveLength(1);
    expect(result.current.resources[0]?.uri).toBe("first");

    await act(async () => {
      (manager as MockPagedResourcesState).simulateLoadPage([
        { uri: "second", name: "Second", mimeType: "text/plain" },
      ]);
    });

    expect(result.current.resources).toHaveLength(2);
    expect(result.current.resources.map((r) => r.uri)).toEqual([
      "first",
      "second",
    ]);
  });

  it("loadPage updates state from manager", async () => {
    const manager = new MockPagedResourcesState();
    const client = {} as InspectorClient;
    (manager as MockPagedResourcesState).loadPage = async function (
      _cursor?: string,
    ) {
      this.simulateLoadPage([
        { uri: "x", name: "X", mimeType: "text/plain" },
        { uri: "y", name: "Y", mimeType: "text/plain" },
      ]);
      return {
        resources: [
          { uri: "x", name: "X", mimeType: "text/plain" },
          { uri: "y", name: "Y", mimeType: "text/plain" },
        ],
        nextCursor: undefined,
      };
    };

    const { result } = renderHook(() =>
      usePagedResources(client, manager as unknown as PagedResourcesState),
    );

    expect(result.current.resources).toHaveLength(0);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.resources).toHaveLength(2);
    });

    expect(result.current.resources).toHaveLength(2);
    expect(result.current.resources.map((r) => r.uri)).toEqual(["x", "y"]);
  });

  it("clear empties resources", async () => {
    const manager = new MockPagedResourcesState();
    manager.appendResources([
      { uri: "a", name: "A", mimeType: "text/plain" },
      { uri: "b", name: "B", mimeType: "text/plain" },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedResources(client, manager as unknown as PagedResourcesState),
    );

    expect(result.current.resources).toHaveLength(2);

    act(() => {
      result.current.clear();
    });

    expect(result.current.resources).toEqual([]);
  });

  it("clears resources when manager switches to null", async () => {
    const manager = new MockPagedResourcesState();
    manager.appendResources([
      { uri: "only", name: "Only", mimeType: "text/plain" },
    ]);
    const client = {} as InspectorClient;

    type Props = {
      client: InspectorClient | null;
      manager: PagedResourcesState | null;
    };
    const { result, rerender } = renderHook(
      ({ client: c, manager: m }: Props) => usePagedResources(c, m),
      {
        initialProps: {
          client,
          manager: manager as unknown as PagedResourcesState,
        } as Props,
      },
    );

    expect(result.current.resources).toHaveLength(1);

    rerender({ client, manager: null });

    expect(result.current.resources).toEqual([]);
  });
});
