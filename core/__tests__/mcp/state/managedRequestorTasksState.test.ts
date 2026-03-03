/**
 * ManagedRequestorTasksState tests use a mock InspectorClient to test refresh,
 * event subscriptions (connect, tasksListChanged, taskStatusChange, requestorTaskUpdated, taskCancelled, statusChange), and destroy.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import { ManagedRequestorTasksState } from "../../../mcp/state/managedRequestorTasksState.js";
import type { InspectorClient } from "../../../mcp/inspectorClient.js";

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

function createMockClient(
  listTasksImpl: (
    cursor?: string,
  ) => Promise<{ tasks: Task[]; nextCursor?: string }>,
): InspectorClient {
  const eventTarget = new EventTarget();
  return {
    getStatus: vi.fn().mockReturnValue("connected"),
    listRequestorTasks: vi.fn().mockImplementation(listTasksImpl),
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
  } as unknown as InspectorClient;
}

describe("ManagedRequestorTasksState", () => {
  let state: ManagedRequestorTasksState | null = null;

  afterEach(() => {
    if (state) {
      state.destroy();
      state = null;
    }
  });

  function waitForTasksChange(s: ManagedRequestorTasksState): Promise<Task[]> {
    return new Promise((resolve) => {
      s.addEventListener(
        "tasksChange",
        (e: Event) => resolve((e as CustomEvent).detail),
        {
          once: true,
        },
      );
    });
  }

  it("starts with empty tasks", () => {
    const client = createMockClient(async () => ({ tasks: [] }));
    state = new ManagedRequestorTasksState(client);
    expect(state.getTasks()).toEqual([]);
  });

  it("refresh loads all pages and dispatches tasksChange", async () => {
    const task1 = createMockTask({ taskId: "t1" });
    const task2 = createMockTask({ taskId: "t2" });
    const client = createMockClient(async (cursor) => {
      if (cursor === undefined) return { tasks: [task1], nextCursor: "c1" };
      return { tasks: [task2], nextCursor: undefined };
    });
    state = new ManagedRequestorTasksState(client);

    const tasksPromise = waitForTasksChange(state);
    const result = await state.refresh();
    await tasksPromise;

    expect(result).toHaveLength(2);
    expect(state.getTasks().map((t) => t.taskId)).toEqual(["t1", "t2"]);
  });

  it("connect triggers refresh", async () => {
    const task1 = createMockTask({ taskId: "t1" });
    const client = createMockClient(async () => ({
      tasks: [task1],
      nextCursor: undefined,
    }));
    state = new ManagedRequestorTasksState(client);

    const tasksPromise = waitForTasksChange(state);
    client.dispatchEvent(new CustomEvent("connect"));
    await tasksPromise;

    expect(state.getTasks()).toHaveLength(1);
    expect(state.getTasks()[0]?.taskId).toBe("t1");
  });

  it("tasksListChanged triggers refresh", async () => {
    const task1 = createMockTask({ taskId: "t1" });
    const client = createMockClient(async () => ({
      tasks: [task1],
      nextCursor: undefined,
    }));
    state = new ManagedRequestorTasksState(client);

    const tasksPromise = waitForTasksChange(state);
    client.dispatchEvent(new CustomEvent("tasksListChanged"));
    await tasksPromise;

    expect(state.getTasks()).toHaveLength(1);
  });

  it("taskStatusChange merges task into list", async () => {
    const task1 = createMockTask({ taskId: "t1", status: "pending" });
    const client = createMockClient(async () => ({
      tasks: [task1],
      nextCursor: undefined,
    }));
    state = new ManagedRequestorTasksState(client);
    await state.refresh();

    const updated = createMockTask({ taskId: "t1", status: "completed" });
    const tasksPromise = waitForTasksChange(state);
    client.dispatchEvent(
      new CustomEvent("taskStatusChange", {
        detail: { taskId: "t1", task: updated },
      }),
    );
    await tasksPromise;

    expect(state.getTasks()).toHaveLength(1);
    expect(state.getTasks()[0]?.status).toBe("completed");
  });

  it("requestorTaskUpdated merges new task at head", async () => {
    const client = createMockClient(async () => ({
      tasks: [],
      nextCursor: undefined,
    }));
    state = new ManagedRequestorTasksState(client);
    await state.refresh();

    const newTask = createMockTask({ taskId: "new1", status: "working" });
    const tasksPromise = waitForTasksChange(state);
    client.dispatchEvent(
      new CustomEvent("requestorTaskUpdated", {
        detail: { taskId: "new1", task: newTask },
      }),
    );
    await tasksPromise;

    expect(state.getTasks()).toHaveLength(1);
    expect(state.getTasks()[0]?.taskId).toBe("new1");
  });

  it("taskCancelled updates task status in list", async () => {
    const task1 = createMockTask({ taskId: "t1", status: "working" });
    const client = createMockClient(async () => ({
      tasks: [task1],
      nextCursor: undefined,
    }));
    state = new ManagedRequestorTasksState(client);
    await state.refresh();

    const tasksPromise = waitForTasksChange(state);
    client.dispatchEvent(
      new CustomEvent("taskCancelled", { detail: { taskId: "t1" } }),
    );
    await tasksPromise;

    expect(state.getTasks()).toHaveLength(1);
    expect(state.getTasks()[0]?.status).toBe("cancelled");
  });

  it("statusChange to disconnected clears tasks", async () => {
    const client = createMockClient(async () => ({
      tasks: [createMockTask({ taskId: "t1" })],
      nextCursor: undefined,
    }));
    (client.getStatus as ReturnType<typeof vi.fn>).mockReturnValue("connected");
    state = new ManagedRequestorTasksState(client);
    await state.refresh();
    expect(state.getTasks()).toHaveLength(1);

    (client.getStatus as ReturnType<typeof vi.fn>).mockReturnValue(
      "disconnected",
    );
    const tasksPromise = waitForTasksChange(state);
    client.dispatchEvent(
      new CustomEvent("statusChange", { detail: "disconnected" }),
    );
    await tasksPromise;

    expect(state.getTasks()).toEqual([]);
  });

  it("destroy unsubscribes and clears state", async () => {
    const client = createMockClient(async () => ({
      tasks: [createMockTask({ taskId: "t1" })],
      nextCursor: undefined,
    }));
    state = new ManagedRequestorTasksState(client);
    await state.refresh();
    state.destroy();
    expect(state.getTasks()).toEqual([]);
  });
});
