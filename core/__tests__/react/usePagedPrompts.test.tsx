/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagedPrompts } from "../../react/usePagedPrompts.js";
import type { PagedPromptsState } from "../../mcp/state/pagedPromptsState.js";
import type { InspectorClient } from "../../mcp/inspectorClient.js";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

/**
 * Mock PagedPromptsState: getPrompts(), loadPage(), and promptsChange events.
 */
class MockPagedPromptsState extends EventTarget {
  private _prompts: Prompt[] = [];

  getPrompts(): Prompt[] {
    return [...this._prompts];
  }

  appendPrompts(prompts: Prompt[]): void {
    this._prompts = [...this._prompts, ...prompts];
    this.dispatchEvent(
      new CustomEvent("promptsChange", { detail: this._prompts }),
    );
  }

  async loadPage(_cursor?: string): Promise<{
    prompts: Prompt[];
    nextCursor?: string;
  }> {
    return { prompts: this._prompts, nextCursor: undefined };
  }

  simulateLoadPage(prompts: Prompt[], _nextCursor?: string): void {
    this._prompts = [...this._prompts, ...prompts];
    this.dispatchEvent(
      new CustomEvent("promptsChange", { detail: this._prompts }),
    );
  }

  clear(): void {
    this._prompts = [];
    this.dispatchEvent(
      new CustomEvent("promptsChange", { detail: this._prompts }),
    );
  }

  destroy(): void {
    this._prompts = [];
  }
}

describe("usePagedPrompts", () => {
  it("returns empty prompts, no-op loadPage, and no-op clear when given null client and null manager", async () => {
    const { result } = renderHook(() => usePagedPrompts(null, null));

    expect(result.current.prompts).toEqual([]);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.prompts).toEqual([]);
      expect(page.nextCursor).toBeUndefined();
    });
    expect(result.current.prompts).toEqual([]);

    act(() => {
      result.current.clear();
    });
    expect(result.current.prompts).toEqual([]);
  });

  it("returns empty prompts when manager is null", async () => {
    const client = {} as InspectorClient;
    const { result } = renderHook(() => usePagedPrompts(client, null));

    expect(result.current.prompts).toEqual([]);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.prompts).toEqual([]);
    });
  });

  it("syncs initial prompts from manager", () => {
    const manager = new MockPagedPromptsState();
    manager.appendPrompts([
      { name: "a", arguments: [] },
      { name: "b", arguments: [] },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedPrompts(client, manager as unknown as PagedPromptsState),
    );

    expect(result.current.prompts).toHaveLength(2);
    expect(result.current.prompts.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("updates prompts when manager dispatches promptsChange", async () => {
    const manager = new MockPagedPromptsState();
    manager.appendPrompts([{ name: "first", arguments: [] }]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedPrompts(client, manager as unknown as PagedPromptsState),
    );

    expect(result.current.prompts).toHaveLength(1);
    expect(result.current.prompts[0]?.name).toBe("first");

    await act(async () => {
      (manager as MockPagedPromptsState).simulateLoadPage([
        { name: "second", arguments: [] },
      ]);
    });

    expect(result.current.prompts).toHaveLength(2);
    expect(result.current.prompts.map((p) => p.name)).toEqual([
      "first",
      "second",
    ]);
  });

  it("loadPage updates state from manager", async () => {
    const manager = new MockPagedPromptsState();
    const client = {} as InspectorClient;
    (manager as MockPagedPromptsState).loadPage = async function (
      _cursor?: string,
    ) {
      this.simulateLoadPage([
        { name: "x", arguments: [] },
        { name: "y", arguments: [] },
      ]);
      return {
        prompts: [
          { name: "x", arguments: [] },
          { name: "y", arguments: [] },
        ],
        nextCursor: undefined,
      };
    };

    const { result } = renderHook(() =>
      usePagedPrompts(client, manager as unknown as PagedPromptsState),
    );

    expect(result.current.prompts).toHaveLength(0);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.prompts).toHaveLength(2);
    });

    expect(result.current.prompts).toHaveLength(2);
    expect(result.current.prompts.map((p) => p.name)).toEqual(["x", "y"]);
  });

  it("clear empties prompts", async () => {
    const manager = new MockPagedPromptsState();
    manager.appendPrompts([
      { name: "a", arguments: [] },
      { name: "b", arguments: [] },
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedPrompts(client, manager as unknown as PagedPromptsState),
    );

    expect(result.current.prompts).toHaveLength(2);

    act(() => {
      result.current.clear();
    });

    expect(result.current.prompts).toEqual([]);
  });

  it("clears prompts when manager switches to null", async () => {
    const manager = new MockPagedPromptsState();
    manager.appendPrompts([{ name: "only", arguments: [] }]);
    const client = {} as InspectorClient;

    type Props = {
      client: InspectorClient | null;
      manager: PagedPromptsState | null;
    };
    const { result, rerender } = renderHook(
      ({ client: c, manager: m }: Props) => usePagedPrompts(c, m),
      {
        initialProps: {
          client,
          manager: manager as unknown as PagedPromptsState,
        } as Props,
      },
    );

    expect(result.current.prompts).toHaveLength(1);

    rerender({ client, manager: null });

    expect(result.current.prompts).toEqual([]);
  });
});
