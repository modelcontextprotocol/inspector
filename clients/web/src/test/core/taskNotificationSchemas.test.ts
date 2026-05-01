import { describe, it, expect } from "vitest";
import { TasksListChangedNotificationSchema } from "@inspector/core/mcp/taskNotificationSchemas.js";

describe("TasksListChangedNotificationSchema", () => {
  it("parses a notification with no params", () => {
    const result = TasksListChangedNotificationSchema.safeParse({
      jsonrpc: "2.0",
      method: "notifications/tasks/list_changed",
    });
    expect(result.success).toBe(true);
  });

  it("parses a notification with an empty params object", () => {
    const result = TasksListChangedNotificationSchema.safeParse({
      jsonrpc: "2.0",
      method: "notifications/tasks/list_changed",
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it("parses a notification with arbitrary params", () => {
    const result = TasksListChangedNotificationSchema.safeParse({
      jsonrpc: "2.0",
      method: "notifications/tasks/list_changed",
      params: { foo: "bar", count: 3 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a notification with the wrong method", () => {
    const result = TasksListChangedNotificationSchema.safeParse({
      jsonrpc: "2.0",
      method: "notifications/resources/list_changed",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when method is missing", () => {
    const result = TasksListChangedNotificationSchema.safeParse({
      jsonrpc: "2.0",
    });
    expect(result.success).toBe(false);
  });
});
