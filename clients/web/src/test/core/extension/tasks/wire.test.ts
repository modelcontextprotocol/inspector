import { describe, expect, it } from "vitest";
import { RELATED_TASK_META_KEY } from "@modelcontextprotocol/client";
import type { TaskView } from "@modelcontextprotocol/ext-tasks/client";
import { taskId } from "@modelcontextprotocol/ext-tasks/core";
import {
  jsonObject,
  paramsWithRelatedTask,
  taskInputOrigin,
  taskToolResultCodec,
  toInspectorTask,
} from "@inspector/core/extension/tasks/wire.js";

describe("taskToolResultCodec", () => {
  it("accepts a CallToolResult and reports issues for anything else", () => {
    const ok = taskToolResultCodec.parse({
      content: [{ type: "text", text: "hi" }],
    });
    expect(ok).toMatchObject({ success: true });
    const bad = taskToolResultCodec.parse({ content: "nope" });
    expect(bad).toMatchObject({ success: false });
  });
});

describe("jsonObject", () => {
  it("projects an object and rejects non-objects", () => {
    expect(jsonObject({ a: 1, b: undefined })).toEqual({ a: 1 });
    expect(() => jsonObject([1])).toThrow(TypeError);
    expect(() => jsonObject("x")).toThrow(TypeError);
  });
});

describe("paramsWithRelatedTask", () => {
  it("stamps the related task and keeps existing _meta", () => {
    const params = paramsWithRelatedTask(
      { message: "m", _meta: { keep: true } },
      "task-1",
    );
    expect(params._meta).toMatchObject({
      keep: true,
      [RELATED_TASK_META_KEY]: { taskId: "task-1" },
    });
  });

  it("ignores a non-object _meta", () => {
    const params = paramsWithRelatedTask({ _meta: [1] }, "task-2");
    expect(params._meta).toEqual({
      [RELATED_TASK_META_KEY]: { taskId: "task-2" },
    });
  });
});

describe("toInspectorTask", () => {
  function view(
    times: Pick<TaskView, "createdAt" | "lastUpdatedAt">,
  ): TaskView {
    return {
      taskId: taskId("a"),
      status: "working",
      retentionMs: null,
      ttl: null,
      raw: {},
      extensions: {},
      ...times,
    };
  }

  it("fills whichever timestamp is missing from the other", () => {
    expect(toInspectorTask(view({ lastUpdatedAt: "t2" }))).toMatchObject({
      createdAt: "t2",
      lastUpdatedAt: "t2",
    });
    expect(toInspectorTask(view({ createdAt: "t1" }))).toMatchObject({
      createdAt: "t1",
      lastUpdatedAt: "t1",
    });
    expect(toInspectorTask(view({}))).toMatchObject({
      createdAt: "",
      lastUpdatedAt: "",
    });
  });
});

describe("taskInputOrigin", () => {
  it("maps each delivery to its pending-request origin", () => {
    expect(
      (["peer-request", "request-retry", "task-update"] as const).map(
        taskInputOrigin,
      ),
    ).toEqual(["server-request", "input-required", "task-input-required"]);
  });
});
