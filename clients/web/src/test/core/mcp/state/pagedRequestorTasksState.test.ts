import { describe, it, expect, beforeEach } from "vitest";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import { PagedRequestorTasksState } from "@inspector/core/mcp/state/pagedRequestorTasksState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function task(taskId: string, status: Task["status"] = "working"): Task {
  return {
    taskId,
    status,
    ttl: null,
    createdAt: "2026-05-13T00:00:00Z",
    lastUpdatedAt: "2026-05-13T00:00:00Z",
  };
}

function waitForChange(state: PagedRequestorTasksState): Promise<Task[]> {
  return new Promise((resolve) => {
    state.addEventListener("tasksChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

describe("PagedRequestorTasksState", () => {
  let client: FakeInspectorClient;
  let state: PagedRequestorTasksState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new PagedRequestorTasksState(client);
  });

  it("starts empty and exposes nextCursor", () => {
    expect(state.getTasks()).toEqual([]);
    expect(state.getNextCursor()).toBeUndefined();
  });

  it("loadPage no-ops when disconnected", async () => {
    const result = await state.loadPage();
    expect(result).toEqual({ tasks: [], nextCursor: undefined });
    expect(client.listRequestorTasks).not.toHaveBeenCalled();
  });

  it("loadPage without cursor replaces tasks and stores nextCursor", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1")], nextCursor: "c1" });
    const changePromise = waitForChange(state);
    const result = await state.loadPage();
    expect(result.tasks.map((t) => t.taskId)).toEqual(["t1"]);
    expect(result.nextCursor).toBe("c1");
    expect(state.getNextCursor()).toBe("c1");
    expect(await changePromise).toEqual(result.tasks);
  });

  it("loadPage with cursor appends tasks and updates nextCursor", async () => {
    client.setStatus("connected");
    client.queueTaskPages(
      { tasks: [task("t1")], nextCursor: "c1" },
      { tasks: [task("t2")] },
    );
    await state.loadPage();
    await state.loadPage("c1");
    expect(state.getTasks().map((t) => t.taskId)).toEqual(["t1", "t2"]);
    expect(state.getNextCursor()).toBeUndefined();
  });

  it("clear empties tasks, resets nextCursor, and dispatches", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1")], nextCursor: "c1" });
    await state.loadPage();
    const changePromise = waitForChange(state);
    state.clear();
    expect(await changePromise).toEqual([]);
    expect(state.getTasks()).toEqual([]);
    expect(state.getNextCursor()).toBeUndefined();
  });

  it("tasksListChanged refetches the first page", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1"), task("t2")] });
    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("tasksListChanged");
    const next = await changePromise;
    expect(next.map((t) => t.taskId)).toEqual(["t1", "t2"]);
  });

  it("taskStatusChange merges a known task", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1", "working")] });
    await state.loadPage();

    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("taskStatusChange", {
      taskId: "t1",
      task: task("t1", "completed"),
    });
    const next = await changePromise;
    expect(next[0]!.status).toBe("completed");
  });

  it("requestorTaskUpdated inserts an unknown task at the front", async () => {
    client.setStatus("connected");
    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("requestorTaskUpdated", {
      taskId: "tx",
      task: {
        taskId: "tx",
        status: "working",
        ttl: null,
        lastUpdatedAt: "2026-05-13T03:00:00Z",
      },
    });
    const next = await changePromise;
    expect(next.map((t) => t.taskId)).toEqual(["tx"]);
    expect(next[0]!.createdAt).toBe("2026-05-13T03:00:00Z");
  });

  it("taskCancelled flips status when the task is known", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1", "working")] });
    await state.loadPage();
    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("taskCancelled", { taskId: "t1" });
    const next = await changePromise;
    expect(next[0]!.status).toBe("cancelled");
  });

  it("taskCancelled is a no-op when the task is unknown", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1")] });
    await state.loadPage();
    let dispatched = false;
    state.addEventListener("tasksChange", () => {
      dispatched = true;
    });
    client.dispatchTypedEvent("taskCancelled", { taskId: "missing" });
    expect(dispatched).toBe(false);
    expect(state.getTasks().map((t) => t.taskId)).toEqual(["t1"]);
  });

  it("statusChange to disconnected clears tasks and nextCursor", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1")], nextCursor: "c1" });
    await state.loadPage();
    const changePromise = waitForChange(state);
    client.setStatus("disconnected");
    expect(await changePromise).toEqual([]);
    expect(state.getNextCursor()).toBeUndefined();
  });

  it("destroy stops listening and clears state", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1")] });
    await state.loadPage();
    state.destroy();
    expect(state.getTasks()).toEqual([]);
    expect(state.getNextCursor()).toBeUndefined();
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
