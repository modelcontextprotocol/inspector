import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { ManagedRequestorTasksState } from "@inspector/core/mcp/state/managedRequestorTasksState";
import { useManagedRequestorTasks } from "@inspector/core/react/useManagedRequestorTasks";

function task(taskId: string, status: Task["status"] = "working"): Task {
  return {
    taskId,
    status,
    ttl: null,
    createdAt: "2026-05-13T00:00:00Z",
    lastUpdatedAt: "2026-05-13T00:00:00Z",
  };
}

describe("useManagedRequestorTasks", () => {
  let client: FakeInspectorClient;
  let state: ManagedRequestorTasksState;

  beforeEach(() => {
    // Capabilities include `tasks` so refresh() reaches the live
    // listRequestorTasks path; the state manager gates on capability.
    client = new FakeInspectorClient({
      status: "connected",
      capabilities: { tasks: {} },
    });
    state = new ManagedRequestorTasksState(client);
  });

  it("returns the initial tasks snapshot from the state", async () => {
    client.queueTaskPages({ tasks: [task("t1"), task("t2")] });
    await state.refresh();

    const { result } = renderHook(() =>
      useManagedRequestorTasks(client, state),
    );
    expect(result.current.tasks.map((t) => t.taskId)).toEqual(["t1", "t2"]);
  });

  it("returns empty tasks when state is null", () => {
    const { result } = renderHook(() => useManagedRequestorTasks(client, null));
    expect(result.current.tasks).toEqual([]);
  });

  it("updates when state dispatches tasksChange", async () => {
    const { result } = renderHook(() =>
      useManagedRequestorTasks(client, state),
    );
    expect(result.current.tasks).toEqual([]);

    client.queueTaskPages({ tasks: [task("t1")] });
    await act(async () => {
      await state.refresh();
    });

    await waitFor(() => {
      expect(result.current.tasks.map((t) => t.taskId)).toEqual(["t1"]);
    });
  });

  it("refresh() calls through to state and returns the next tasks", async () => {
    client.queueTaskPages({ tasks: [task("tx")] });
    const { result } = renderHook(() =>
      useManagedRequestorTasks(client, state),
    );

    let next: Task[] = [];
    await act(async () => {
      next = await result.current.refresh();
    });

    expect(next.map((t) => t.taskId)).toEqual(["tx"]);
    expect(result.current.tasks.map((t) => t.taskId)).toEqual(["tx"]);
  });

  it("refresh() returns [] when state or client is null", async () => {
    const { result } = renderHook(() => useManagedRequestorTasks(null, state));
    await expect(result.current.refresh()).resolves.toEqual([]);

    const { result: result2 } = renderHook(() =>
      useManagedRequestorTasks(client, null),
    );
    await expect(result2.current.refresh()).resolves.toEqual([]);
  });

  it("resets to empty tasks when the state prop becomes null", async () => {
    client.queueTaskPages({ tasks: [task("t1")] });
    await state.refresh();

    const { result, rerender } = renderHook(
      ({ s }: { s: ManagedRequestorTasksState | null }) =>
        useManagedRequestorTasks(client, s),
      { initialProps: { s: state as ManagedRequestorTasksState | null } },
    );
    await waitFor(() => {
      expect(result.current.tasks.map((t) => t.taskId)).toEqual(["t1"]);
    });

    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.tasks).toEqual([]);
    });
  });

  it("unsubscribes from the state on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useManagedRequestorTasks(client, state),
    );

    unmount();

    client.queueTaskPages({ tasks: [task("t1")] });
    await state.refresh();

    expect(result.current.tasks).toEqual([]);
  });
});
