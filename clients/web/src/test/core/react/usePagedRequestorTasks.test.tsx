import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { PagedRequestorTasksState } from "@inspector/core/mcp/state/pagedRequestorTasksState";
import { usePagedRequestorTasks } from "@inspector/core/react/usePagedRequestorTasks";

function task(taskId: string, status: Task["status"] = "working"): Task {
  return {
    taskId,
    status,
    ttl: null,
    createdAt: "2026-05-13T00:00:00Z",
    lastUpdatedAt: "2026-05-13T00:00:00Z",
  };
}

describe("usePagedRequestorTasks", () => {
  let client: FakeInspectorClient;
  let state: PagedRequestorTasksState;

  beforeEach(() => {
    client = new FakeInspectorClient({ status: "connected" });
    state = new PagedRequestorTasksState(client);
  });

  it("returns the initial snapshot and nextCursor", async () => {
    client.queueTaskPages({ tasks: [task("t1")], nextCursor: "c1" });
    await state.loadPage();
    const { result } = renderHook(() => usePagedRequestorTasks(client, state));
    expect(result.current.tasks.map((t) => t.taskId)).toEqual(["t1"]);
    expect(result.current.nextCursor).toBe("c1");
  });

  it("returns empty + undefined cursor when state is null", () => {
    const { result } = renderHook(() => usePagedRequestorTasks(client, null));
    expect(result.current.tasks).toEqual([]);
    expect(result.current.nextCursor).toBeUndefined();
  });

  it("updates tasks and nextCursor when state dispatches tasksChange", async () => {
    const { result } = renderHook(() => usePagedRequestorTasks(client, state));
    client.queueTaskPages({ tasks: [task("t1")], nextCursor: "c1" });
    await act(async () => {
      await state.loadPage();
    });
    await waitFor(() => {
      expect(result.current.tasks.map((t) => t.taskId)).toEqual(["t1"]);
    });
    expect(result.current.nextCursor).toBe("c1");
  });

  it("loadPage proxies to the state and returns the result", async () => {
    client.queueTaskPages({ tasks: [task("tx")], nextCursor: "cx" });
    const { result } = renderHook(() => usePagedRequestorTasks(client, state));
    let next;
    await act(async () => {
      next = await result.current.loadPage();
    });
    expect(next).toEqual({ tasks: [task("tx")], nextCursor: "cx" });
    expect(result.current.nextCursor).toBe("cx");
  });

  it("loadPage returns empty when state or client is null", async () => {
    const { result } = renderHook(() => usePagedRequestorTasks(null, state));
    await expect(result.current.loadPage()).resolves.toEqual({
      tasks: [],
      nextCursor: undefined,
    });
    const { result: r2 } = renderHook(() =>
      usePagedRequestorTasks(client, null),
    );
    await expect(r2.current.loadPage()).resolves.toEqual({
      tasks: [],
      nextCursor: undefined,
    });
  });

  it("clear() proxies to the state", async () => {
    client.queueTaskPages({ tasks: [task("t1")], nextCursor: "c1" });
    await state.loadPage();
    const { result } = renderHook(() => usePagedRequestorTasks(client, state));
    act(() => {
      result.current.clear();
    });
    await waitFor(() => {
      expect(result.current.tasks).toEqual([]);
      expect(result.current.nextCursor).toBeUndefined();
    });
  });

  it("clear() is a no-op when state is null", () => {
    const { result } = renderHook(() => usePagedRequestorTasks(client, null));
    expect(() => result.current.clear()).not.toThrow();
  });

  it("resets to empty when the state prop becomes null", async () => {
    client.queueTaskPages({ tasks: [task("t1")] });
    await state.loadPage();
    const { result, rerender } = renderHook(
      ({ s }: { s: PagedRequestorTasksState | null }) =>
        usePagedRequestorTasks(client, s),
      { initialProps: { s: state as PagedRequestorTasksState | null } },
    );
    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.tasks).toEqual([]);
      expect(result.current.nextCursor).toBeUndefined();
    });
  });

  it("unsubscribes on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      usePagedRequestorTasks(client, state),
    );
    unmount();
    client.queueTaskPages({ tasks: [task("t1")] });
    await state.loadPage();
    expect(result.current.tasks).toEqual([]);
  });
});
