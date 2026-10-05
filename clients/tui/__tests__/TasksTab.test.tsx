import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "./helpers/renderTui";
import type { Task } from "@modelcontextprotocol/client";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";

const CHALLENGE = { reason: "insufficient_scope" as const };

vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import {
  TasksTab,
  hasTaskResult,
  isTaskActive,
  taskStatusStyle,
} from "../src/components/TasksTab.js";

const tick = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};
const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

const task = (over: Partial<Task> = {}): Task =>
  ({
    taskId: "task-1",
    status: "working",
    createdAt: "2026-01-01T00:00:00Z",
    lastUpdatedAt: "2026-01-01T00:00:01Z",
    ttl: 60000,
    ...over,
  }) as Task;

interface FakeOps {
  cancelRequestorTask: ReturnType<typeof vi.fn>;
  getRequestorTaskResult: ReturnType<typeof vi.fn>;
}

// A deliberately partial fake: TasksTab calls only the two methods in
// `FakeOps` on the client, and InspectorClient is a class with private members
// that no structural object literal can satisfy, so a single `as` is refused.
// The double cast is confined to this factory, and `FakeOps` keeps the methods
// the tests assert on typed.
const fakeClient = (over: Partial<FakeOps> = {}): FakeOps & InspectorClient =>
  ({
    cancelRequestorTask: vi.fn(async () => {}),
    getRequestorTaskResult: vi.fn(async () => ({
      content: [{ type: "text", text: "done" }],
    })),
    ...over,
  }) as unknown as FakeOps & InspectorClient;

function renderTab(props: Partial<React.ComponentProps<typeof TasksTab>> = {}) {
  const onRefresh = vi.fn(async () => []);
  const onClearCompleted = vi.fn();
  const client = fakeClient();
  const api = render(
    <TasksTab
      tasks={[task()]}
      inspectorClient={client}
      width={100}
      height={30}
      focusedPane="list"
      onRefresh={onRefresh}
      onClearCompleted={onClearCompleted}
      {...props}
    />,
  );
  return { ...api, onRefresh, onClearCompleted, client };
}

describe("task status helpers", () => {
  it("styles known and unknown statuses", () => {
    expect(taskStatusStyle("completed").color).toBe("green");
    expect(taskStatusStyle("mystery")).toEqual({ glyph: "·", color: "gray" });
  });

  it("classifies active and result-bearing statuses", () => {
    expect(isTaskActive("working")).toBe(true);
    expect(isTaskActive("input_required")).toBe(true);
    expect(isTaskActive("completed")).toBe(false);
    expect(hasTaskResult("completed")).toBe(true);
    expect(hasTaskResult("failed")).toBe(true);
    expect(hasTaskResult("cancelled")).toBe(false);
  });
});

describe("TasksTab", () => {
  it("shows an empty state", () => {
    const { lastFrame } = renderTab({ tasks: [] });
    expect(lastFrame()).toContain("Tasks (0)");
    expect(lastFrame()).toContain("No tasks yet");
    expect(lastFrame()).toContain("Select a task to view details");
  });

  it("renders the selected task's details and footer", () => {
    const { lastFrame } = renderTab({
      tasks: [task({ statusMessage: "halfway", pollInterval: 500 })],
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Tasks (1)");
    expect(frame).toContain("Status: working");
    expect(frame).toContain("halfway");
    expect(frame).toContain("Updated: 2026-01-01T00:00:01Z");
    expect(frame).toContain("TTL: 60000  Poll: 500ms");
    expect(frame).toContain("x cancel");
  });

  it("renders a task without optional fields", () => {
    const { lastFrame } = renderTab({
      tasks: [task({ ttl: null, lastUpdatedAt: undefined })],
      focusedPane: "details",
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("TTL: none");
    expect(frame).not.toContain("Updated:");
    expect(frame).toContain("+ zoom");
  });

  it("navigates the list with the arrow keys", async () => {
    const { lastFrame, stdin } = renderTab({
      tasks: [task(), task({ taskId: "task-2", status: "failed" })],
    });
    stdin.write(DOWN);
    await tick();
    expect(lastFrame()).toContain("Status: failed");
    stdin.write(DOWN); // already at the end
    await tick();
    stdin.write(UP);
    await tick();
    expect(lastFrame()).toContain("Status: working");
    stdin.write(UP); // already at the top
    await tick();
    expect(lastFrame()).toContain("Status: working");
  });

  it("refreshes on 'f' and clears completed on 'l'", async () => {
    const { stdin, onRefresh, onClearCompleted } = renderTab();
    stdin.write("f");
    await tick();
    stdin.write("l");
    await tick();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onClearCompleted).toHaveBeenCalledTimes(1);
  });

  it("surfaces a refresh failure", async () => {
    const { stdin, lastFrame } = renderTab({
      onRefresh: vi.fn(async () => {
        throw new Error("list failed");
      }),
    });
    stdin.write("f");
    await tick();
    expect(lastFrame()).toContain("list failed");
  });

  it("surfaces a non-Error failure with no task selected", async () => {
    const { stdin, lastFrame } = renderTab({
      tasks: [],
      onRefresh: vi.fn(() => Promise.reject("plain failure")),
    });
    stdin.write("f");
    await tick();
    expect(lastFrame()).toContain("plain failure");
  });

  it("shows the busy line while an operation is pending", async () => {
    let release: () => void = () => {};
    const pending = new Promise<never[]>((resolve) => {
      release = () => resolve([]);
    });
    const onRefresh = vi.fn(() => pending);
    const { stdin, lastFrame } = renderTab({ onRefresh });
    stdin.write("f");
    await tick();
    expect(lastFrame()).toContain("Refreshing…");
    // A second press while the first is in flight starts nothing.
    stdin.write("f");
    stdin.write("x");
    await tick();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    release();
    await tick();
    expect(lastFrame()).not.toContain("Refreshing…");
  });

  it("shows the busy line in the empty state too", async () => {
    let release: () => void = () => {};
    const pending = new Promise<never[]>((resolve) => {
      release = () => resolve([]);
    });
    const { stdin, lastFrame } = renderTab({
      tasks: [],
      onRefresh: () => pending,
    });
    stdin.write("f");
    await tick();
    expect(lastFrame()).toContain("Refreshing…");
    release();
    await tick();
  });

  it("cancels an active task on 'x'", async () => {
    const client = fakeClient();
    const { stdin } = renderTab({ inspectorClient: client });
    stdin.write("x");
    await tick();
    expect(client.cancelRequestorTask).toHaveBeenCalledWith("task-1");
  });

  it("does not cancel a terminal task", async () => {
    const client = fakeClient();
    const { stdin } = renderTab({
      inspectorClient: client,
      tasks: [task({ status: "completed" })],
    });
    stdin.write("x");
    await tick();
    expect(client.cancelRequestorTask).not.toHaveBeenCalled();
  });

  it("fetches and shows a terminal task's result on Enter, and zooms it", async () => {
    const client = fakeClient();
    const onViewDetails = vi.fn();
    const { stdin, lastFrame, rerender, onRefresh, onClearCompleted } =
      renderTab({
        inspectorClient: client,
        tasks: [task({ status: "completed" })],
      });
    stdin.write("\r");
    await tick();
    expect(client.getRequestorTaskResult).toHaveBeenCalledWith("task-1");
    expect(lastFrame()).toContain("Result:");
    expect(lastFrame()).toContain("done");

    rerender(
      <TasksTab
        tasks={[task({ status: "completed" })]}
        inspectorClient={client}
        width={100}
        height={30}
        focusedPane="details"
        onRefresh={onRefresh}
        onClearCompleted={onClearCompleted}
        onViewDetails={onViewDetails}
      />,
    );
    await tick();
    stdin.write("+");
    await tick();
    expect(onViewDetails).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1" }),
      { content: [{ type: "text", text: "done" }] },
    );
  });

  it("does not fetch a result for a task still running", async () => {
    const client = fakeClient();
    const { stdin } = renderTab({ inspectorClient: client });
    stdin.write("\r");
    await tick();
    expect(client.getRequestorTaskResult).not.toHaveBeenCalled();
  });

  it("hands auth recovery to the caller", async () => {
    const recovery = new AuthRecoveryRequiredError(
      new URL("https://auth.example/start"),
      CHALLENGE,
    );
    const client = fakeClient({
      cancelRequestorTask: vi.fn(async () => {
        throw recovery;
      }),
    });
    const onAuthRecoveryRequired = vi.fn();
    const { stdin, lastFrame } = renderTab({
      inspectorClient: client,
      onAuthRecoveryRequired,
    });
    stdin.write("x");
    await tick();
    expect(onAuthRecoveryRequired).toHaveBeenCalledWith(recovery);
    expect(lastFrame()).not.toContain("Error");
  });

  it("tolerates auth recovery with no handler", async () => {
    const client = fakeClient({
      cancelRequestorTask: vi.fn(async () => {
        throw new AuthRecoveryRequiredError(
          new URL("https://auth.example"),
          CHALLENGE,
        );
      }),
    });
    const { stdin, lastFrame } = renderTab({ inspectorClient: client });
    stdin.write("x");
    await tick();
    expect(lastFrame()).toContain("Status: working");
  });

  it("scrolls the details pane and ignores zoom without a handler", async () => {
    const { stdin, lastFrame } = renderTab({ focusedPane: "details" });
    for (const k of [UP, DOWN, PAGE_UP, PAGE_DOWN, "+", "z"]) {
      stdin.write(k);
      await tick();
    }
    expect(lastFrame()).toContain("Status: working");
  });

  it("does nothing without a client", async () => {
    const { stdin, lastFrame } = renderTab({
      inspectorClient: null,
      tasks: [task({ status: "completed" })],
    });
    stdin.write("x");
    stdin.write("\r");
    await tick();
    expect(lastFrame()).not.toContain("Result:");
  });

  it("ignores keys while a modal is open", async () => {
    const { stdin, onRefresh } = renderTab({ modalOpen: true });
    stdin.write("f");
    await tick();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
