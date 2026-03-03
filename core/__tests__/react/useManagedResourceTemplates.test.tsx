/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useManagedResourceTemplates } from "../../react/useManagedResourceTemplates.js";
import type { ManagedResourceTemplatesState } from "../../mcp/state/managedResourceTemplatesState.js";
import type { InspectorClient } from "../../mcp/inspectorClient.js";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";

/**
 * Mock ManagedResourceTemplatesState: getResourceTemplates(), refresh(), and resourceTemplatesChange events.
 */
class MockManagedResourceTemplatesState extends EventTarget {
  private _templates: ResourceTemplate[] = [];

  getResourceTemplates(): ResourceTemplate[] {
    return [...this._templates];
  }

  setResourceTemplates(templates: ResourceTemplate[]): void {
    this._templates = templates;
    this.dispatchEvent(
      new CustomEvent("resourceTemplatesChange", { detail: templates }),
    );
  }

  async refresh(): Promise<ResourceTemplate[]> {
    return this.getResourceTemplates();
  }

  destroy(): void {
    this._templates = [];
  }
}

describe("useManagedResourceTemplates", () => {
  it("returns empty resourceTemplates and no-op refresh when given null client and null manager", async () => {
    const { result } = renderHook(() =>
      useManagedResourceTemplates(null, null),
    );

    expect(result.current.resourceTemplates).toEqual([]);

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toEqual([]);
    });
    expect(result.current.resourceTemplates).toEqual([]);
  });

  it("returns empty resourceTemplates when manager is null", async () => {
    const client = {} as InspectorClient;
    const { result } = renderHook(() =>
      useManagedResourceTemplates(client, null),
    );

    expect(result.current.resourceTemplates).toEqual([]);

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toEqual([]);
    });
  });

  it("syncs initial resourceTemplates from manager", () => {
    const manager = new MockManagedResourceTemplatesState();
    manager.setResourceTemplates([
      { uriTemplate: "file:///{path}", name: "file" },
      { uriTemplate: "user://{id}", name: "user" },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedResourceTemplates(
        client,
        manager as unknown as ManagedResourceTemplatesState,
      ),
    );

    expect(result.current.resourceTemplates).toHaveLength(2);
    expect(result.current.resourceTemplates.map((t) => t.uriTemplate)).toEqual([
      "file:///{path}",
      "user://{id}",
    ]);
  });

  it("updates resourceTemplates when manager dispatches resourceTemplatesChange", async () => {
    const manager = new MockManagedResourceTemplatesState();
    manager.setResourceTemplates([{ uriTemplate: "first", name: "First" }]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedResourceTemplates(
        client,
        manager as unknown as ManagedResourceTemplatesState,
      ),
    );

    expect(result.current.resourceTemplates).toHaveLength(1);
    expect(result.current.resourceTemplates[0]?.uriTemplate).toBe("first");

    await act(async () => {
      (manager as MockManagedResourceTemplatesState).setResourceTemplates([
        { uriTemplate: "first", name: "First" },
        { uriTemplate: "second", name: "Second" },
      ]);
    });

    expect(result.current.resourceTemplates).toHaveLength(2);
    expect(result.current.resourceTemplates.map((t) => t.uriTemplate)).toEqual([
      "first",
      "second",
    ]);
  });

  it("refresh updates state from manager", async () => {
    const manager = new MockManagedResourceTemplatesState();
    manager.setResourceTemplates([{ uriTemplate: "x", name: "X" }]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedResourceTemplates(
        client,
        manager as unknown as ManagedResourceTemplatesState,
      ),
    );

    expect(result.current.resourceTemplates).toHaveLength(1);

    await act(async () => {
      (manager as MockManagedResourceTemplatesState).setResourceTemplates([
        { uriTemplate: "x", name: "X" },
        { uriTemplate: "y", name: "Y" },
      ]);
    });

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toHaveLength(2);
    });

    expect(result.current.resourceTemplates).toHaveLength(2);
  });

  it("clears resourceTemplates when manager switches to null", async () => {
    const manager = new MockManagedResourceTemplatesState();
    manager.setResourceTemplates([{ uriTemplate: "only", name: "Only" }]);
    const client = {} as InspectorClient;

    const { result, rerender } = renderHook(
      ({ client: c, manager: m }) => useManagedResourceTemplates(c, m),
      {
        initialProps: {
          client,
          manager: manager as unknown as ManagedResourceTemplatesState,
        },
      },
    );

    expect(result.current.resourceTemplates).toHaveLength(1);

    rerender({ client, manager: null });

    expect(result.current.resourceTemplates).toEqual([]);
  });
});
