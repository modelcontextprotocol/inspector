import { describe, it, expect } from "vitest";
import {
  TASKS_EXTENSION_KEY,
  MODERN_PROTOCOL_VERSION,
  MODERN_TASK_HANDLE_META,
  TASKS_EXTENSION_CLIENT_CAPABILITY,
  ModernDetailedTaskSchema,
  ModernGetTaskResultSchema,
  ModernUpdateTaskResultSchema,
  ModernCancelTaskResultSchema,
  normalizeModernTask,
  readInputRequests,
  isModernCreateTaskResult,
} from "@inspector/core/mcp/modernTaskSchemas.js";

describe("modernTaskSchemas (#1631)", () => {
  const baseTask = {
    taskId: "abc",
    status: "working" as const,
    createdAt: "2026-07-20T00:00:00Z",
    lastUpdatedAt: "2026-07-20T00:00:01Z",
  };

  describe("constants", () => {
    it("exposes the SEP-2663 identifiers", () => {
      expect(TASKS_EXTENSION_KEY).toBe("io.modelcontextprotocol/tasks");
      expect(MODERN_PROTOCOL_VERSION).toBe("2026-07-28");
      expect(MODERN_TASK_HANDLE_META).toContain("modernTaskHandle");
      expect(
        TASKS_EXTENSION_CLIENT_CAPABILITY.extensions[TASKS_EXTENSION_KEY],
      ).toEqual({});
    });
  });

  describe("ModernDetailedTaskSchema", () => {
    it("parses a working task and passes unknown fields through (loose)", () => {
      const parsed = ModernDetailedTaskSchema.parse({
        ...baseTask,
        ttlMs: 60000,
        pollIntervalMs: 500,
        somethingNew: "kept",
      });
      expect(parsed.taskId).toBe("abc");
      expect((parsed as Record<string, unknown>).somethingNew).toBe("kept");
    });

    it("accepts a null ttlMs and inline result/error/inputRequests", () => {
      const completed = ModernGetTaskResultSchema.parse({
        ...baseTask,
        status: "completed",
        ttlMs: null,
        result: { content: [{ type: "text", text: "done" }] },
      });
      expect(completed.result).toBeDefined();
      const failed = ModernDetailedTaskSchema.parse({
        ...baseTask,
        status: "failed",
        error: { code: -1, message: "boom" },
      });
      expect(failed.error).toBeDefined();
    });

    it("rejects a task missing required identity fields", () => {
      expect(() =>
        ModernDetailedTaskSchema.parse({ status: "working" }),
      ).toThrow();
    });

    it("accepts empty update/cancel acks", () => {
      expect(ModernUpdateTaskResultSchema.parse({})).toEqual({});
      expect(
        ModernCancelTaskResultSchema.parse({ resultType: "complete" }),
      ).toBeDefined();
    });
  });

  describe("normalizeModernTask", () => {
    it("maps ttlMs → ttl and pollIntervalMs → pollInterval", () => {
      const task = normalizeModernTask({
        ...baseTask,
        ttlMs: 60000,
        pollIntervalMs: 250,
      });
      expect(task.ttl).toBe(60000);
      expect((task as { pollInterval?: number }).pollInterval).toBe(250);
    });

    it("defaults ttl to null and omits pollInterval when absent", () => {
      const task = normalizeModernTask({ ...baseTask });
      expect(task.ttl).toBeNull();
      expect((task as { pollInterval?: number }).pollInterval).toBeUndefined();
    });

    it("carries the status-specific members structurally", () => {
      const task = normalizeModernTask({
        ...baseTask,
        status: "completed",
        ttlMs: null,
        result: { content: [] },
      });
      expect((task as { result?: unknown }).result).toEqual({ content: [] });
    });
  });

  describe("readInputRequests", () => {
    it("returns the inputRequests map when present", () => {
      const requests = { confirm: { method: "elicitation/create" } };
      const out = readInputRequests({
        ...baseTask,
        status: "input_required",
        inputRequests: requests,
      });
      expect(out).toBe(requests);
    });

    it("returns undefined when absent", () => {
      expect(readInputRequests({ ...baseTask })).toBeUndefined();
    });
  });

  describe("isModernCreateTaskResult", () => {
    it("is true only for a resultType:task frame with a taskId", () => {
      expect(
        isModernCreateTaskResult({ resultType: "task", taskId: "x" }),
      ).toBe(true);
    });

    it("is false for complete results, non-objects, and missing taskId", () => {
      expect(isModernCreateTaskResult({ resultType: "complete" })).toBe(false);
      expect(isModernCreateTaskResult({ resultType: "task" })).toBe(false);
      expect(isModernCreateTaskResult({ content: [] })).toBe(false);
      expect(isModernCreateTaskResult(null)).toBe(false);
      expect(isModernCreateTaskResult("task")).toBe(false);
    });
  });
});
