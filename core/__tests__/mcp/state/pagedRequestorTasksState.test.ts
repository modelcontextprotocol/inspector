/**
 * PagedRequestorTasksState tests use a mock InspectorClient to test loadPage,
 * clear, event subscriptions (tasksListChanged, taskStatusChange, requestorTaskUpdated, taskCancelled, statusChange), and destroy.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import { PagedRequestorTasksState } from "../../../mcp/state/pagedRequestorTasksState.js";
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
  const addEventListener = eventTarget.addEventListener.bind(eventTarget);
  const removeEventListener = eventTarget.removeEventListener.bind(eventTarget);
  const dispatchEvent = eventTarget.dispatchEvent.bind(eventTarget);
  return {
    getStatus: vi.fn().mockReturnValue("connected"),
    listRequestorTasks: vi.fn().mockImplementation(listTasksImpl),
    addEventListener,
    removeEventListener,
    dispatchEvent,
  } as unknown as InspectorClient;
}

describe("PagedRequestorTasksState", () => {
  let state: PagedRequestorTasksState | null = null;

  afterEach(() => {
    if (state) {
      state.destroy();
      state = null;
    }
  });

  function waitForTasksChange(s: PagedRequestorTasksState): Promise<Task[]> {
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
    state = new PagedRequestorTasksState(client);
    expect(state.getTasks()).toEqual([]);
    expect(state.getNextCursor()).toBeUndefined();
  });

  it("loadPage(undefined) loads first page and sets nextCursor", async () => {
    const task1 = createMockTask({ taskId: "t1" });
    const client = createMockClient(async (cursor) => {
      if (cursor === undefined) {
        return { tasks: [task1], nextCursor: "cursor2" };
      }
      return { tasks: [], nextCursor: undefined };
    });
    state = new PagedRequestorTasksState(client);

    const tasksPromise = waitForTasksChange(state);
    const result = await state.loadPage();
    await tasksPromise;

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.taskId).toBe("t1");
    expect(result.nextCursor).toBe("cursor2");
    expect(state.getTasks()).toHaveLength(1);
    expect(state.getNextCursor()).toBe("cursor2");
  });

  it("loadPage(cursor) appends and updates nextCursor", async () => {
    const task1 = createMockTask({ taskId: "t1" });
    const task2 = createMockTask({ taskId: "t2" });
    const client = createMockClient(async (cursor) => {
      if (cursor === undefined) return { tasks: [task1], nextCursor: "c1" };
      return { tasks: [task2], nextCursor: undefined };
    });
    state = new PagedRequestorTasksState(client);

    await state.loadPage();
    const tasksPromise = waitForTasksChange(state);
    const result = await state.loadPage("c1");
    await tasksPromise;

    expect(result.tasks).toHaveLength(1);
    expect(state.getTasks()).toHaveLength(2);
    expect(state.getTasks().map((t) => t.taskId)).toEqual(["t1", "t2"]);
    expect(state.getNextCursor()).toBeUndefined();
  });

  it("clear empties list and dispatches tasksChange", async () => {
    const client = createMockClient(async () => ({
      tasks: [createMockTask({ taskId: "t1" })],
      nextCursor: undefined,
    }));
    state = new PagedRequestorTasksState(client);
    await state.loadPage();
    expect(state.getTasks()).toHaveLength(1);

    const tasksPromise = waitForTasksChange(state);
    state.clear();
    const tasks = await tasksPromise;

    expect(tasks).toEqual([]);
    expect(state.getTasks()).toEqual([]);
    expect(state.getNextCursor()).toBeUndefined();
  });

  it("taskStatusChange merges task into list", async () => {
    const task1 = createMockTask({ taskId: "t1", status: "pending" });
    const client = createMockClient(async () => ({
      tasks: [task1],
      nextCursor: undefined,
    }));
    state = new PagedRequestorTasksState(client);
    await state.loadPage();

    const updated = createMockTask({ taskId: "t1", status: "working" });
    const tasksPromise = waitForTasksChange(state);
    client.dispatchEvent(
      new CustomEvent("taskStatusChange", {
        detail: { taskId: "t1", task: updated },
      }),
    );
    await tasksPromise;

    expect(state.getTasks()).toHaveLength(1);
    expect(state.getTasks()[0]?.status).toBe("working");
  });

  it("requestorTaskUpdated merges new task at head", async () => {
    const client = createMockClient(async () => ({
      tasks: [],
      nextCursor: undefined,
    }));
    state = new PagedRequestorTasksState(client);
    await state.loadPage();

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
    state = new PagedRequestorTasksState(client);
    await state.loadPage();

    const tasksPromise = waitForTasksChange(state);
    client.dispatchEvent(
      new CustomEvent("taskCancelled", { detail: { taskId: "t1" } }),
    );
    await tasksPromise;

    expect(state.getTasks()).toHaveLength(1);
    expect(state.getTasks()[0]?.status).toBe("cancelled");
  });

  it("tasksListChanged triggers loadPage(undefined)", async () => {
    const task1 = createMockTask({ taskId: "t1" });
    const client = createMockClient(async () => ({
      tasks: [task1],
      nextCursor: undefined,
    }));
    state = new PagedRequestorTasksState(client);

    const tasksPromise = waitForTasksChange(state);
    client.dispatchEvent(new CustomEvent("tasksListChanged"));
    await tasksPromise;

    expect(state.getTasks()).toHaveLength(1);
    expect(state.getTasks()[0]?.taskId).toBe("t1");
  });

  it("statusChange to disconnected clears tasks", async () => {
    const client = createMockClient(async () => ({
      tasks: [createMockTask({ taskId: "t1" })],
      nextCursor: undefined,
    }));
    (client.getStatus as ReturnType<typeof vi.fn>).mockReturnValue("connected");
    state = new PagedRequestorTasksState(client);
    await state.loadPage();
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
    expect(state.getNextCursor()).toBeUndefined();
  });

  it("destroy unsubscribes and clears state", async () => {
    const client = createMockClient(async () => ({
      tasks: [createMockTask({ taskId: "t1" })],
      nextCursor: undefined,
    }));
    state = new PagedRequestorTasksState(client);
    await state.loadPage();
    state.destroy();
    expect(state.getTasks()).toEqual([]);
    expect(state.getNextCursor()).toBeUndefined();
  });
});
