/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useManagedResources } from "../../react/useManagedResources.js";
import type { ManagedResourcesState } from "../../mcp/state/managedResourcesState.js";
import type { InspectorClient } from "../../mcp/inspectorClient.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";

/**
 * Mock ManagedResourcesState: getResources(), refresh(), and resourcesChange events.
 */
class MockManagedResourcesState extends EventTarget {
  private _resources: Resource[] = [];

  getResources(): Resource[] {
    return [...this._resources];
  }

  setResources(resources: Resource[]): void {
    this._resources = resources;
    this.dispatchEvent(
      new CustomEvent("resourcesChange", { detail: resources }),
    );
  }

  async refresh(): Promise<Resource[]> {
    return this.getResources();
  }

  destroy(): void {
    this._resources = [];
  }
}

describe("useManagedResources", () => {
  it("returns empty resources and no-op refresh when given null client and null manager", async () => {
    const { result } = renderHook(() => useManagedResources(null, null));

    expect(result.current.resources).toEqual([]);

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toEqual([]);
    });
    expect(result.current.resources).toEqual([]);
  });

  it("returns empty resources when manager is null", async () => {
    const client = {} as InspectorClient;
    const { result } = renderHook(() => useManagedResources(client, null));

    expect(result.current.resources).toEqual([]);

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toEqual([]);
    });
  });

  it("syncs initial resources from manager", () => {
    const manager = new MockManagedResourcesState();
    manager.setResources([
      { uri: "a://1", name: "A", mimeType: "text/plain" },
      { uri: "b://2", name: "B", mimeType: "text/plain" },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedResources(client, manager as unknown as ManagedResourcesState),
    );

    expect(result.current.resources).toHaveLength(2);
    expect(result.current.resources.map((r) => r.uri)).toEqual([
      "a://1",
      "b://2",
    ]);
  });

  it("updates resources when manager dispatches resourcesChange", async () => {
    const manager = new MockManagedResourcesState();
    manager.setResources([
      { uri: "first", name: "First", mimeType: "text/plain" },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedResources(client, manager as unknown as ManagedResourcesState),
    );

    expect(result.current.resources).toHaveLength(1);
    expect(result.current.resources[0]?.uri).toBe("first");

    await act(async () => {
      (manager as MockManagedResourcesState).setResources([
        { uri: "first", name: "First", mimeType: "text/plain" },
        { uri: "second", name: "Second", mimeType: "text/plain" },
      ]);
    });

    expect(result.current.resources).toHaveLength(2);
    expect(result.current.resources.map((r) => r.uri)).toEqual([
      "first",
      "second",
    ]);
  });

  it("refresh updates state from manager", async () => {
    const manager = new MockManagedResourcesState();
    manager.setResources([{ uri: "x", name: "X", mimeType: "text/plain" }]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedResources(client, manager as unknown as ManagedResourcesState),
    );

    expect(result.current.resources).toHaveLength(1);

    await act(async () => {
      (manager as MockManagedResourcesState).setResources([
        { uri: "x", name: "X", mimeType: "text/plain" },
        { uri: "y", name: "Y", mimeType: "text/plain" },
      ]);
    });

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toHaveLength(2);
    });

    expect(result.current.resources).toHaveLength(2);
  });

  it("clears resources when manager switches to null", async () => {
    const manager = new MockManagedResourcesState();
    manager.setResources([
      { uri: "only", name: "Only", mimeType: "text/plain" },
    ]);
    const client = {} as InspectorClient;

    const { result, rerender } = renderHook(
      ({ client: c, manager: m }) => useManagedResources(c, m),
      {
        initialProps: {
          client,
          manager: manager as unknown as ManagedResourcesState,
        },
      },
    );

    expect(result.current.resources).toHaveLength(1);

    rerender({ client, manager: null });

    expect(result.current.resources).toEqual([]);
  });
});
