import { describe, it, expect, beforeEach } from "vitest";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import { ManagedRequestorTasksState } from "@inspector/core/mcp/state/managedRequestorTasksState";
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

function waitForChange(state: ManagedRequestorTasksState): Promise<Task[]> {
  return new Promise((resolve) => {
    state.addEventListener("tasksChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

describe("ManagedRequestorTasksState", () => {
  let client: FakeInspectorClient;
  let state: ManagedRequestorTasksState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    state = new ManagedRequestorTasksState(client);
  });

  it("starts with empty tasks", () => {
    expect(state.getTasks()).toEqual([]);
  });

  it("getTasks returns a defensive copy", () => {
    const a = state.getTasks();
    const b = state.getTasks();
    expect(a).not.toBe(b);
  });

  it("refresh returns early and does not call listRequestorTasks when disconnected", async () => {
    const result = await state.refresh();
    expect(result).toEqual([]);
    expect(client.listRequestorTasks).not.toHaveBeenCalled();
  });

  it("refresh fetches a single page and dispatches tasksChange", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1"), task("t2")] });

    const changePromise = waitForChange(state);
    const result = await state.refresh();

    expect(result.map((t) => t.taskId)).toEqual(["t1", "t2"]);
    expect(await changePromise).toEqual(result);
  });

  it("refresh accumulates across multiple paginated pages", async () => {
    client.setStatus("connected");
    client.queueTaskPages(
      { tasks: [task("t1")], nextCursor: "c1" },
      { tasks: [task("t2")], nextCursor: "c2" },
      { tasks: [task("t3")] },
    );

    const result = await state.refresh();
    expect(result.map((t) => t.taskId)).toEqual(["t1", "t2", "t3"]);
    expect(client.listRequestorTasks).toHaveBeenCalledTimes(3);
  });

  it("connect event triggers a refresh", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1")] });
    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("connect");
    const next = await changePromise;
    expect(next.map((t) => t.taskId)).toEqual(["t1"]);
  });

  it("tasksListChanged event triggers a refresh", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1"), task("t2")] });
    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("tasksListChanged");
    const next = await changePromise;
    expect(next.map((t) => t.taskId)).toEqual(["t1", "t2"]);
  });

  it("statusChange to disconnected clears tasks and dispatches tasksChange", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1")] });
    await state.refresh();
    expect(state.getTasks()).toHaveLength(1);

    const changePromise = waitForChange(state);
    client.setStatus("disconnected");
    const next = await changePromise;
    expect(next).toEqual([]);
    expect(state.getTasks()).toEqual([]);
  });

  it("statusChange to other values does not clear tasks", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1")] });
    await state.refresh();
    client.setStatus("error");
    expect(state.getTasks().map((t) => t.taskId)).toEqual(["t1"]);
  });

  it("taskStatusChange inserts a new task when the id is unknown", async () => {
    client.setStatus("connected");
    const newTask = task("t1", "working");
    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("taskStatusChange", {
      taskId: "t1",
      task: newTask,
    });
    const next = await changePromise;
    expect(next.map((t) => t.taskId)).toEqual(["t1"]);
    expect(next[0]!.status).toBe("working");
  });

  it("taskStatusChange replaces an existing task in place", async () => {
    client.setStatus("connected");
    client.queueTaskPages({
      tasks: [task("t1", "working"), task("t2", "working")],
    });
    await state.refresh();

    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("taskStatusChange", {
      taskId: "t1",
      task: task("t1", "completed"),
    });
    const next = await changePromise;
    expect(next.map((t) => t.taskId)).toEqual(["t1", "t2"]);
    expect(next.find((t) => t.taskId === "t1")!.status).toBe("completed");
  });

  it("requestorTaskUpdated falls back to lastUpdatedAt when createdAt is missing", async () => {
    client.setStatus("connected");
    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("requestorTaskUpdated", {
      taskId: "t1",
      task: {
        taskId: "t1",
        status: "working",
        ttl: null,
        lastUpdatedAt: "2026-05-13T01:00:00Z",
      },
    });
    const next = await changePromise;
    expect(next[0]!.createdAt).toBe("2026-05-13T01:00:00Z");
  });

  it("taskCancelled flips status to cancelled when the task is known", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1", "working")] });
    await state.refresh();

    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("taskCancelled", { taskId: "t1" });
    const next = await changePromise;
    expect(next[0]!.status).toBe("cancelled");
  });

  it("taskCancelled is a no-op when the task is unknown", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1")] });
    await state.refresh();

    let dispatched = false;
    state.addEventListener("tasksChange", () => {
      dispatched = true;
    });
    client.dispatchTypedEvent("taskCancelled", { taskId: "missing" });
    expect(dispatched).toBe(false);
    expect(state.getTasks().map((t) => t.taskId)).toEqual(["t1"]);
  });

  it("throws when pagination exceeds 100 pages", async () => {
    client.setStatus("connected");
    client.listRequestorTasks.mockImplementation(async () => ({
      tasks: [task("t1")],
      nextCursor: "always",
    }));
    await expect(state.refresh()).rejects.toThrow(/Maximum pagination limit/);
  });

  it("destroy unsubscribes from client events and clears state", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1")] });
    await state.refresh();
    expect(state.getTasks()).toHaveLength(1);

    state.destroy();
    expect(state.getTasks()).toEqual([]);

    client.queueTaskPages({ tasks: [task("t2")] });
    client.dispatchTypedEvent("tasksListChanged");
    await Promise.resolve();
    expect(state.getTasks()).toEqual([]);
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
