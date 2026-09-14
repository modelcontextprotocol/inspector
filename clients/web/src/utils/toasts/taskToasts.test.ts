import { describe, expect, it } from "vitest";
import {
  formatTaskToastMessage,
  isTerminalTaskStatus,
  TASK_CANCELLED_TOAST_AUTOCLOSE_MS,
  taskToastColor,
  taskToastId,
  TERMINAL_TASK_STATUSES,
} from "./taskToasts";

describe("TASK_CANCELLED_TOAST_AUTOCLOSE_MS", () => {
  it("auto-dismisses the one-shot confirmation", () => {
    expect(TASK_CANCELLED_TOAST_AUTOCLOSE_MS).toBe(5000);
  });
});

describe("isTerminalTaskStatus", () => {
  it("is true for every terminal status", () => {
    for (const status of TERMINAL_TASK_STATUSES) {
      expect(isTerminalTaskStatus(status)).toBe(true);
    }
    expect([...TERMINAL_TASK_STATUSES].sort()).toEqual([
      "cancelled",
      "completed",
      "failed",
    ]);
  });

  it("is false for a status that can still change", () => {
    expect(isTerminalTaskStatus("working")).toBe(false);
    expect(isTerminalTaskStatus("input_required")).toBe(false);
  });
});

describe("taskToastId", () => {
  it("keys one toast per task", () => {
    expect(taskToastId("t1")).toBe("task-t1");
    expect(taskToastId("t2")).not.toBe(taskToastId("t1"));
  });
});

describe("taskToastColor", () => {
  it("mirrors the TaskStatusBadge mapping", () => {
    expect(taskToastColor("completed")).toBe("green");
    expect(taskToastColor("failed")).toBe("red");
    expect(taskToastColor("cancelled")).toBe("gray");
    expect(taskToastColor("input_required")).toBe("yellow");
  });

  it("falls back to blue for an in-flight status", () => {
    expect(taskToastColor("working")).toBe("blue");
  });
});

describe("formatTaskToastMessage", () => {
  it("prefers the server's statusMessage", () => {
    expect(
      formatTaskToastMessage({
        status: "working",
        statusMessage: "Step 2 of 3",
      }),
    ).toBe("Step 2 of 3");
  });

  it("falls back to naming the status", () => {
    expect(formatTaskToastMessage({ status: "failed" })).toBe("Task failed");
  });
});
