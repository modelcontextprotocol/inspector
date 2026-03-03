/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagedRequestorTasks } from "../../react/usePagedRequestorTasks.js";
import type { PagedRequestorTasksState } from "../../mcp/state/pagedRequestorTasksState.js";
import type { InspectorClient } from "../../mcp/inspectorClient.js";
import type { Task } from "@modelcontextprotocol/sdk/types.js";

function createMockTask(overrides: Partial<Task> & { taskId: string }): Task {
  return {
    ...overrides,
    taskId: overrides.taskId,
    ttl: overrides.ttl ?? null,
    status: overrides.status ?? "working",
    statusMessage: overrides.statusMessage ?? "",
    lastUpdatedAt: overrides.lastUpdatedAt ?? new Date().toISOString(),
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

class MockPagedRequestorTasksState extends EventTarget {
  private _tasks: Task[] = [];
  private _nextCursor: string | undefined = undefined;

  getTasks(): Task[] {
    return [...this._tasks];
  }

  getNextCursor(): string | undefined {
    return this._nextCursor;
  }

  appendTasks(tasks: Task[], nextCursor?: string): void {
    this._tasks = [...this._tasks, ...tasks];
    this._nextCursor = nextCursor;
    this.dispatchEvent(new CustomEvent("tasksChange", { detail: this._tasks }));
  }

  async loadPage(
    _cursor?: string,
  ): Promise<{ tasks: Task[]; nextCursor?: string }> {
    return { tasks: this._tasks, nextCursor: this._nextCursor };
  }

  simulateLoadPage(tasks: Task[], nextCursor?: string): void {
    this._tasks = [...this._tasks, ...tasks];
    this._nextCursor = nextCursor;
    this.dispatchEvent(new CustomEvent("tasksChange", { detail: this._tasks }));
  }

  clear(): void {
    this._tasks = [];
    this._nextCursor = undefined;
    this.dispatchEvent(new CustomEvent("tasksChange", { detail: this._tasks }));
  }

  destroy(): void {
    this._tasks = [];
    this._nextCursor = undefined;
  }
}

describe("usePagedRequestorTasks", () => {
  it("returns empty tasks, no-op loadPage, no-op clear, and undefined nextCursor when given null client and null manager", async () => {
    const { result } = renderHook(() => usePagedRequestorTasks(null, null));

    expect(result.current.tasks).toEqual([]);
    expect(result.current.nextCursor).toBeUndefined();

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.tasks).toEqual([]);
      expect(page.nextCursor).toBeUndefined();
    });
    expect(result.current.tasks).toEqual([]);

    act(() => {
      result.current.clear();
    });
    expect(result.current.tasks).toEqual([]);
  });

  it("returns empty tasks when manager is null", async () => {
    const client = {} as InspectorClient;
    const { result } = renderHook(() => usePagedRequestorTasks(client, null));

    expect(result.current.tasks).toEqual([]);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.tasks).toEqual([]);
    });
  });

  it("syncs initial tasks and nextCursor from manager", () => {
    const manager = new MockPagedRequestorTasksState();
    manager.appendTasks(
      [createMockTask({ taskId: "t1" }), createMockTask({ taskId: "t2" })],
      "cursor-next",
    );
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedRequestorTasks(
        client,
        manager as unknown as PagedRequestorTasksState,
      ),
    );

    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.tasks.map((t) => t.taskId)).toEqual(["t1", "t2"]);
    expect(result.current.nextCursor).toBe("cursor-next");
  });

  it("updates tasks when manager dispatches tasksChange", async () => {
    const manager = new MockPagedRequestorTasksState();
    manager.appendTasks([createMockTask({ taskId: "t1" })]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedRequestorTasks(
        client,
        manager as unknown as PagedRequestorTasksState,
      ),
    );

    expect(result.current.tasks).toHaveLength(1);

    await act(async () => {
      (manager as MockPagedRequestorTasksState).appendTasks([
        createMockTask({ taskId: "t2" }),
      ]);
    });

    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.tasks.map((t) => t.taskId)).toEqual(["t1", "t2"]);
  });

  it("loadPage updates state from manager", async () => {
    const manager = new MockPagedRequestorTasksState();
    const client = {} as InspectorClient;
    (manager as MockPagedRequestorTasksState).loadPage = async function (
      _cursor?: string,
    ) {
      (this as unknown as { _tasks: Task[] })._tasks = [
        createMockTask({ taskId: "x" }),
        createMockTask({ taskId: "y" }),
      ];
      (this as unknown as { _nextCursor: string | undefined })._nextCursor =
        undefined;
      this.dispatchEvent(
        new CustomEvent("tasksChange", {
          detail: (this as unknown as { _tasks: Task[] })._tasks,
        }),
      );
      return {
        tasks: (this as unknown as { _tasks: Task[] })._tasks,
        nextCursor: undefined,
      };
    };

    const { result } = renderHook(() =>
      usePagedRequestorTasks(
        client,
        manager as unknown as PagedRequestorTasksState,
      ),
    );

    expect(result.current.tasks).toHaveLength(0);

    await act(async () => {
      const page = await result.current.loadPage();
      expect(page.tasks).toHaveLength(2);
    });

    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.tasks.map((t) => t.taskId)).toEqual(["x", "y"]);
  });

  it("clear empties tasks", async () => {
    const manager = new MockPagedRequestorTasksState();
    manager.appendTasks([
      createMockTask({ taskId: "t1" }),
      createMockTask({ taskId: "t2" }),
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      usePagedRequestorTasks(
        client,
        manager as unknown as PagedRequestorTasksState,
      ),
    );

    expect(result.current.tasks).toHaveLength(2);

    act(() => {
      result.current.clear();
    });

    expect(result.current.tasks).toEqual([]);
  });

  it("clears tasks when manager switches to null", async () => {
    const manager = new MockPagedRequestorTasksState();
    manager.appendTasks([createMockTask({ taskId: "only" })]);
    const client = {} as InspectorClient;

    type Props = {
      client: InspectorClient | null;
      manager: PagedRequestorTasksState | null;
    };
    const { result, rerender } = renderHook(
      ({ client: c, manager: m }: Props) => usePagedRequestorTasks(c, m),
      {
        initialProps: {
          client,
          manager: manager as unknown as PagedRequestorTasksState,
        } as Props,
      },
    );

    expect(result.current.tasks).toHaveLength(1);

    rerender({ client, manager: null });

    expect(result.current.tasks).toEqual([]);
    expect(result.current.nextCursor).toBeUndefined();
  });
});
