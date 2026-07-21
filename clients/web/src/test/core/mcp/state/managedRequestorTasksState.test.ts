import { describe, it, expect, beforeEach } from "vitest";
import type { Task } from "@modelcontextprotocol/client";
import { ManagedRequestorTasksState } from "@inspector/core/mcp/state/managedRequestorTasksState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { waitForChangeEvent } from "./waitForChangeEvent";

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
  return waitForChangeEvent(state, "tasksChange");
}

describe("ManagedRequestorTasksState", () => {
  let client: FakeInspectorClient;
  let state: ManagedRequestorTasksState;

  beforeEach(() => {
    // Default to a server that advertises `tasks` so the existing flow tests
    // exercise the live `listRequestorTasks` path; capability-absent tests
    // below override this.
    client = new FakeInspectorClient({ capabilities: { tasks: {} } });
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

  it("refresh skips listRequestorTasks when the server doesn't advertise tasks capability", async () => {
    // Regression: pre-fix we always called tasks/list on connect; servers
    // that don't implement task tracking (the common case) replied with
    // -32601 "Method not found" and the error surfaced in the console.
    const taskless = new FakeInspectorClient({
      capabilities: { tools: {}, prompts: {}, resources: {} },
    });
    taskless.setStatus("connected");
    const tasklessState = new ManagedRequestorTasksState(taskless);

    const result = await tasklessState.refresh();
    expect(result).toEqual([]);
    expect(taskless.listRequestorTasks).not.toHaveBeenCalled();
  });

  it("connect against a tasks-less server doesn't fire listRequestorTasks", async () => {
    // The connect event runs refresh; the capability gate must also catch it
    // there, not only the publicly-callable refresh().
    const taskless = new FakeInspectorClient({
      capabilities: { tools: {} },
    });
    taskless.setStatus("connected");
    const tasklessState = new ManagedRequestorTasksState(taskless);

    const changePromise = waitForChange(tasklessState);
    taskless.dispatchTypedEvent("connect");
    await changePromise;
    expect(taskless.listRequestorTasks).not.toHaveBeenCalled();
    expect(tasklessState.getTasks()).toEqual([]);
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

  it("statusChange to error clears tasks (error is terminal, #1490)", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1")] });
    await state.refresh();
    expect(state.getTasks()).toHaveLength(1);

    const changePromise = waitForChange(state);
    client.setStatus("error");
    const next = await changePromise;
    expect(next).toEqual([]);
    expect(state.getTasks()).toEqual([]);
  });

  it("statusChange to a non-terminal value (connecting) does not clear tasks", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1")] });
    await state.refresh();
    client.setStatus("connecting");
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

  it("keeps a cancelled task cancelled when a later completed update arrives (#1631)", async () => {
    // Cancellation is a deliberate terminal decision: a server that completes the
    // task anyway (cooperative cancel) or the in-flight call resolving must not
    // flip it back to completed.
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1", "working")] });
    await state.refresh();

    client.dispatchTypedEvent("taskCancelled", { taskId: "t1" });
    expect(state.getTasks()[0]!.status).toBe("cancelled");

    // A late server notification and a client-origin update, both "completed":
    let changed = false;
    state.addEventListener("tasksChange", () => {
      changed = true;
    });
    client.dispatchTypedEvent("taskStatusChange", {
      taskId: "t1",
      task: task("t1", "completed"),
    });
    client.dispatchTypedEvent("requestorTaskUpdated", {
      taskId: "t1",
      task: task("t1", "completed"),
    });
    expect(changed).toBe(false);
    expect(state.getTasks()[0]!.status).toBe("cancelled");
  });

  it("still applies a subsequent cancelled update for a cancelled task", async () => {
    client.setStatus("connected");
    client.queueTaskPages({ tasks: [task("t1", "working")] });
    await state.refresh();
    client.dispatchTypedEvent("taskCancelled", { taskId: "t1" });

    // A cancelled-status update is not blocked (it agrees with the sticky state).
    const changePromise = waitForChange(state);
    client.dispatchTypedEvent("taskStatusChange", {
      taskId: "t1",
      task: { ...task("t1", "cancelled"), statusMessage: "stopped" },
    });
    const next = await changePromise;
    expect(next[0]!.status).toBe("cancelled");
    expect(next[0]!.statusMessage).toBe("stopped");
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

  describe("clearCompleted", () => {
    it("drops terminal-state tasks and keeps active ones", async () => {
      client.setStatus("connected");
      client.queueTaskPages({
        tasks: [
          task("active", "working"),
          task("done", "completed"),
          task("bad", "failed"),
          task("gone", "cancelled"),
          task("waiting", "input_required"),
        ],
      });
      await state.refresh();

      const changePromise = waitForChange(state);
      state.clearCompleted();
      const next = await changePromise;
      expect(next.map((t) => t.taskId)).toEqual(["active", "waiting"]);
      expect(state.getTasks().map((t) => t.taskId)).toEqual([
        "active",
        "waiting",
      ]);
    });

    it("is a no-op (no event) when there are no terminal tasks", async () => {
      client.setStatus("connected");
      client.queueTaskPages({ tasks: [task("active", "working")] });
      await state.refresh();

      let dispatched = false;
      state.addEventListener("tasksChange", () => {
        dispatched = true;
      });
      state.clearCompleted();
      expect(dispatched).toBe(false);
      expect(state.getTasks().map((t) => t.taskId)).toEqual(["active"]);
    });

    it("keeps cleared tasks gone across a subsequent refresh (sticky)", async () => {
      client.setStatus("connected");
      client.queueTaskPages({
        tasks: [task("active", "working"), task("done", "completed")],
      });
      await state.refresh();
      state.clearCompleted();
      expect(state.getTasks().map((t) => t.taskId)).toEqual(["active"]);

      // Server still lists the dismissed task on the next refresh — it must be
      // filtered back out rather than reappearing.
      client.queueTaskPages({
        tasks: [task("active", "working"), task("done", "completed")],
      });
      const refreshed = await state.refresh();
      expect(refreshed.map((t) => t.taskId)).toEqual(["active"]);
    });

    it("ignores a late status update for a cleared task (sticky)", async () => {
      client.setStatus("connected");
      client.queueTaskPages({ tasks: [task("done", "completed")] });
      await state.refresh();
      state.clearCompleted();
      expect(state.getTasks()).toEqual([]);

      let dispatched = false;
      state.addEventListener("tasksChange", () => {
        dispatched = true;
      });
      client.dispatchTypedEvent("taskStatusChange", {
        taskId: "done",
        task: task("done", "completed"),
      });
      client.dispatchTypedEvent("requestorTaskUpdated", {
        taskId: "done",
        task: task("done", "working"),
      });
      client.dispatchTypedEvent("taskCancelled", { taskId: "done" });
      expect(dispatched).toBe(false);
      expect(state.getTasks()).toEqual([]);
    });

    it("resets dismissals on disconnect so a reconnect starts fresh", async () => {
      client.setStatus("connected");
      client.queueTaskPages({ tasks: [task("done", "completed")] });
      await state.refresh();
      state.clearCompleted();

      // Disconnect clears the dismissed set...
      client.setStatus("disconnected");
      client.setStatus("connected");

      // ...so the same task id can reappear on a fresh refresh.
      client.queueTaskPages({ tasks: [task("done", "completed")] });
      const refreshed = await state.refresh();
      expect(refreshed.map((t) => t.taskId)).toEqual(["done"]);
    });
  });
});
