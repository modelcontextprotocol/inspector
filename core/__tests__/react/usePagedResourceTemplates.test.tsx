/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagedResourceTemplates } from "../../react/usePagedResourceTemplates.js";
import type { PagedResourceTemplatesState } from "../../mcp/state/pagedResourceTemplatesState.js";
import type { InspectorClient } from "../../mcp/inspectorClient.js";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";

/**
 * Mock PagedResourceTemplatesState: getResourceTemplates(), loadPage(), and resourceTemplatesChange events.
 */
class MockPagedResourceTemplatesState extends EventTarget {
  private _templates: ResourceTemplate[] = [];

  getResourceTemplates(): ResourceTemplate[] {
    return [...this._templates];
  }

  appendTemplates(templates: ResourceTemplate[]): void {
    this._templates = [...this._templates, ...templates];
    this.dispatchEvent(
      new CustomEvent("resourceTemplatesChange", {
        detail: this._templates,
      }),
    );
  }

  async loadPage(_cursor?: string): Promise<{
    resourceTemplates: ResourceTemplate[];
    nextCursor?: string;
  }> {
    return {
      resourceTemplates: this._templates,
      nextCursor: undefined,
    };
  }

  simulateLoadPage(templates: ResourceTemplate[], _nextCursor?: string): void {
    this._templates = [...this._templates, ...templates];
    this.dispatchEvent(
      new CustomEvent("resourceTemplatesChange", {
        detail: this._templates,
      }),
    );
  }

  clear(): void {
    this._templates = [];
    this.dispatchEvent(
      new CustomEvent("resourceTemplatesChange", { detail: this._templates }),
    );
  }

  destroy(): void {
    this._templates = [];
  }
}

describe("usePagedResourceTemplates", () => {
  it("returns empty resourceTemplates, no-op loadPage, and no-op clear when given null client and null manager", async () => {
    const { result } = renderHook(() => usePagedResourceTemplates(null, null));

    expect(result.current.resourceTemplates).toEqual([]);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.resourceTemplates).toEqual([]);
      expect(page.nextCursor).toBeUndefined();
    });
    expect(result.current.resourceTemplates).toEqual([]);

    act(() => {
      result.current.clear();
    });
    expect(result.current.resourceTemplates).toEqual([]);
  });

  it("returns empty resourceTemplates when manager is null", async () => {
    const client = {} as InspectorClient;
    const { result } = renderHook(() =>
      usePagedResourceTemplates(client, null),
    );

    expect(result.current.resourceTemplates).toEqual([]);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.resourceTemplates).toEqual([]);
    });
  });

  it("syncs initial resourceTemplates from manager", () => {
    const manager = new MockPagedResourceTemplatesState();
    manager.appendTemplates([
      { uriTemplate: "file:///{path}", name: "file" },
      { uriTemplate: "user://{id}", name: "user" },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedResourceTemplates(
        client,
        manager as unknown as PagedResourceTemplatesState,
      ),
    );

    expect(result.current.resourceTemplates).toHaveLength(2);
    expect(result.current.resourceTemplates.map((t) => t.uriTemplate)).toEqual([
      "file:///{path}",
      "user://{id}",
    ]);
  });

  it("updates resourceTemplates when manager dispatches resourceTemplatesChange", async () => {
    const manager = new MockPagedResourceTemplatesState();
    manager.appendTemplates([{ uriTemplate: "first", name: "First" }]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedResourceTemplates(
        client,
        manager as unknown as PagedResourceTemplatesState,
      ),
    );

    expect(result.current.resourceTemplates).toHaveLength(1);
    expect(result.current.resourceTemplates[0]?.uriTemplate).toBe("first");

    await act(async () => {
      (manager as MockPagedResourceTemplatesState).simulateLoadPage([
        { uriTemplate: "second", name: "Second" },
      ]);
    });

    expect(result.current.resourceTemplates).toHaveLength(2);
    expect(result.current.resourceTemplates.map((t) => t.uriTemplate)).toEqual([
      "first",
      "second",
    ]);
  });

  it("loadPage updates state from manager", async () => {
    const manager = new MockPagedResourceTemplatesState();
    const client = {} as InspectorClient;
    (manager as MockPagedResourceTemplatesState).loadPage = async function (
      _cursor?: string,
    ) {
      this.simulateLoadPage([
        { uriTemplate: "x", name: "X" },
        { uriTemplate: "y", name: "Y" },
      ]);
      return {
        resourceTemplates: [
          { uriTemplate: "x", name: "X" },
          { uriTemplate: "y", name: "Y" },
        ],
        nextCursor: undefined,
      };
    };

    const { result } = renderHook(() =>
      usePagedResourceTemplates(
        client,
        manager as unknown as PagedResourceTemplatesState,
      ),
    );

    expect(result.current.resourceTemplates).toHaveLength(0);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.resourceTemplates).toHaveLength(2);
    });

    expect(result.current.resourceTemplates).toHaveLength(2);
    expect(result.current.resourceTemplates.map((t) => t.uriTemplate)).toEqual([
      "x",
      "y",
    ]);
  });

  it("clear empties resourceTemplates", async () => {
    const manager = new MockPagedResourceTemplatesState();
    manager.appendTemplates([
      { uriTemplate: "a", name: "A" },
      { uriTemplate: "b", name: "B" },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedResourceTemplates(
        client,
        manager as unknown as PagedResourceTemplatesState,
      ),
    );

    expect(result.current.resourceTemplates).toHaveLength(2);

    act(() => {
      result.current.clear();
    });

    expect(result.current.resourceTemplates).toEqual([]);
  });

  it("clears resourceTemplates when manager switches to null", async () => {
    const manager = new MockPagedResourceTemplatesState();
    manager.appendTemplates([{ uriTemplate: "only", name: "Only" }]);
    const client = {} as InspectorClient;

    type Props = {
      client: InspectorClient | null;
      manager: PagedResourceTemplatesState | null;
    };
    const { result, rerender } = renderHook(
      ({ client: c, manager: m }: Props) => usePagedResourceTemplates(c, m),
      {
        initialProps: {
          client,
          manager: manager as unknown as PagedResourceTemplatesState,
        } as Props,
      },
    );

    expect(result.current.resourceTemplates).toHaveLength(1);

    rerender({ client, manager: null });

    expect(result.current.resourceTemplates).toEqual([]);
  });
});
