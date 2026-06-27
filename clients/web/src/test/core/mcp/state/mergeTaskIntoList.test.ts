import { describe, it, expect } from "vitest";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import type { TaskWithOptionalCreatedAt } from "@inspector/core/mcp/inspectorClientEventTarget";
import { mergeTaskIntoList } from "@inspector/core/mcp/state/mergeTaskIntoList";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: "t1",
    status: "working",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUpdatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Task;
}

describe("mergeTaskIntoList", () => {
  it("inserts a new task at the front when the id is not present", () => {
    const existing: Task[] = [makeTask({ taskId: "existing" })];
    const result = mergeTaskIntoList(
      existing,
      "new",
      makeTask({ taskId: "x" }),
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.taskId).toBe("new");
    expect(result[1]!.taskId).toBe("existing");
    // Original list is not mutated.
    expect(existing).toHaveLength(1);
  });

  it("replaces an existing task in place, preserving order", () => {
    const existing: Task[] = [
      makeTask({ taskId: "a", status: "working" }),
      makeTask({ taskId: "b", status: "working" }),
      makeTask({ taskId: "c", status: "working" }),
    ];
    const result = mergeTaskIntoList(
      existing,
      "b",
      makeTask({ taskId: "ignored", status: "completed" }),
    );
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.taskId)).toEqual(["a", "b", "c"]);
    expect(result[1]!.status).toBe("completed");
    // taskId is overwritten with the keyed id, not the task's own taskId.
    expect(result[1]!.taskId).toBe("b");
    // Original list is not mutated.
    expect(existing[1]!.status).toBe("working");
  });

  it("uses the task's createdAt when present", () => {
    const result = mergeTaskIntoList(
      [],
      "t",
      makeTask({ createdAt: "2026-05-05T00:00:00.000Z" }),
    );
    expect(result[0]!.createdAt).toBe("2026-05-05T00:00:00.000Z");
  });

  it("falls back to lastUpdatedAt when createdAt is absent", () => {
    const task: TaskWithOptionalCreatedAt = {
      taskId: "t",
      status: "working",
      lastUpdatedAt: "2026-06-06T00:00:00.000Z",
    } as TaskWithOptionalCreatedAt;
    const result = mergeTaskIntoList([], "t", task);
    expect(result[0]!.createdAt).toBe("2026-06-06T00:00:00.000Z");
  });

  it('falls back to "" when neither createdAt nor lastUpdatedAt is present', () => {
    const task = {
      taskId: "t",
      status: "working",
    } as unknown as TaskWithOptionalCreatedAt;
    const result = mergeTaskIntoList([], "t", task);
    expect(result[0]!.createdAt).toBe("");
  });
});
