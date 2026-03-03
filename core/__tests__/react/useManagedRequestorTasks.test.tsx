/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useManagedRequestorTasks } from "../../react/useManagedRequestorTasks.js";
import type { ManagedRequestorTasksState } from "../../mcp/state/managedRequestorTasksState.js";
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

class MockManagedRequestorTasksState extends EventTarget {
  private _tasks: Task[] = [];

  getTasks(): Task[] {
    return [...this._tasks];
  }

  async refresh(): Promise<Task[]> {
    return this.getTasks();
  }

  setTasks(tasks: Task[]): void {
    this._tasks = [...tasks];
    this.dispatchEvent(new CustomEvent("tasksChange", { detail: this._tasks }));
  }

  destroy(): void {
    this._tasks = [];
  }
}

describe("useManagedRequestorTasks", () => {
  it("returns empty tasks and no-op refresh when given null client and null manager", async () => {
    const { result } = renderHook(() => useManagedRequestorTasks(null, null));

    expect(result.current.tasks).toEqual([]);

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toEqual([]);
    });
    expect(result.current.tasks).toEqual([]);
  });

  it("returns empty tasks when manager is null", async () => {
    const client = {} as InspectorClient;
    const { result } = renderHook(() => useManagedRequestorTasks(client, null));

    expect(result.current.tasks).toEqual([]);

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toEqual([]);
    });
  });

  it("syncs initial tasks from manager", () => {
    const manager = new MockManagedRequestorTasksState();
    manager.setTasks([
      createMockTask({ taskId: "t1" }),
      createMockTask({ taskId: "t2" }),
    ]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedRequestorTasks(
        client,
        manager as unknown as ManagedRequestorTasksState,
      ),
    );

    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.tasks.map((t) => t.taskId)).toEqual(["t1", "t2"]);
  });

  it("updates tasks when manager dispatches tasksChange", async () => {
    const manager = new MockManagedRequestorTasksState();
    manager.setTasks([createMockTask({ taskId: "t1" })]);
    const client = {} as InspectorClient;

    const { result } = renderHook(() =>
      useManagedRequestorTasks(
        client,
        manager as unknown as ManagedRequestorTasksState,
      ),
    );

    expect(result.current.tasks).toHaveLength(1);

    await act(async () => {
      (manager as MockManagedRequestorTasksState).setTasks([
        createMockTask({ taskId: "t1" }),
        createMockTask({ taskId: "t2" }),
      ]);
    });

    expect(result.current.tasks).toHaveLength(2);
  });

  it("refresh updates state from manager", async () => {
    const manager = new MockManagedRequestorTasksState();
    const client = {} as InspectorClient;
    (manager as MockManagedRequestorTasksState).refresh = async function () {
      this.setTasks([
        createMockTask({ taskId: "a" }),
        createMockTask({ taskId: "b" }),
      ]);
      return this.getTasks();
    };

    const { result } = renderHook(() =>
      useManagedRequestorTasks(
        client,
        manager as unknown as ManagedRequestorTasksState,
      ),
    );

    expect(result.current.tasks).toHaveLength(0);

    await act(async () => {
      const next = await result.current.refresh();
      expect(next).toHaveLength(2);
    });

    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.tasks.map((t) => t.taskId)).toEqual(["a", "b"]);
  });

  it("clears tasks when manager switches to null", async () => {
    const manager = new MockManagedRequestorTasksState();
    manager.setTasks([createMockTask({ taskId: "only" })]);
    const client = {} as InspectorClient;

    type Props = {
      client: InspectorClient | null;
      manager: ManagedRequestorTasksState | null;
    };
    const { result, rerender } = renderHook(
      ({ client: c, manager: m }: Props) => useManagedRequestorTasks(c, m),
      {
        initialProps: {
          client,
          manager: manager as unknown as ManagedRequestorTasksState,
        } as Props,
      },
    );

    expect(result.current.tasks).toHaveLength(1);

    rerender({ client, manager: null });

    expect(result.current.tasks).toEqual([]);
  });
});
