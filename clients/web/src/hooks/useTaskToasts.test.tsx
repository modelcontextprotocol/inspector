import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import type { Task } from "@modelcontextprotocol/client";
import { InspectorClientEventTarget } from "@inspector/core/mcp/inspectorClientEventTarget.js";
import { renderWithMantine } from "../test/renderWithMantine";
import { taskToastId } from "../utils/toasts/taskToasts";
import { useTaskToasts, type TaskToasts } from "./useTaskToasts";

const { notificationsMock } = vi.hoisted(() => ({
  notificationsMock: {
    show: vi.fn(),
    update: vi.fn(),
    hide: vi.fn(),
    clean: vi.fn(),
  },
}));
vi.mock("@mantine/notifications", () => ({
  notifications: notificationsMock,
}));

/**
 * The client's own typed event target — exactly the surface the hook declares,
 * so the events dispatched below are the same typed events the client emits.
 */
function fakeClient(): InspectorClientEventTarget {
  return new InspectorClientEventTarget();
}

/** A complete `Task`; only `status` varies across these tests. */
const task = (taskId: string, status: Task["status"]): Task => ({
  taskId,
  status,
  ttl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUpdatedAt: "2026-01-01T00:00:00.000Z",
});

function harness(client: InspectorClientEventTarget) {
  let latest: TaskToasts | undefined;
  function Probe({ c }: { c: InspectorClientEventTarget | null }) {
    latest = useTaskToasts(c);
    return null;
  }
  const { rerender, unmount } = renderWithMantine(<Probe c={client} />);
  const dispatch = (fn: () => void) => act(fn);
  return {
    api: () => {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
    taskProgress: (taskId: string, progress: number, total?: number) =>
      dispatch(() =>
        client.dispatchTypedEvent("requestorTaskProgress", {
          taskId,
          progress: { progress, total },
        }),
      ),
    statusChange: (taskId: string, status: Task["status"]) =>
      dispatch(() =>
        client.dispatchTypedEvent("taskStatusChange", {
          taskId,
          task: task(taskId, status),
        }),
      ),
    requestorUpdate: (taskId: string, status: Task["status"]) =>
      dispatch(() =>
        client.dispatchTypedEvent("requestorTaskUpdated", {
          taskId,
          task: task(taskId, status),
        }),
      ),
    cancelled: (taskId: string) =>
      dispatch(() => client.dispatchTypedEvent("taskCancelled", { taskId })),
    toolCallTask: (taskId: string) =>
      dispatch(() =>
        client.dispatchTypedEvent("toolCallTaskUpdated", {
          taskId,
          task: task(taskId, "working"),
        }),
      ),
    run: (fn: (api: TaskToasts) => void) =>
      act(() => {
        if (!latest) throw new Error("hook did not render");
        fn(latest);
      }),
    /** Same as `statusChange`, but from a client swapped in after mount. */
    statusChangeOn: (
      next: InspectorClientEventTarget,
      taskId: string,
      status: Task["status"],
    ) =>
      dispatch(() =>
        next.dispatchTypedEvent("taskStatusChange", {
          taskId,
          task: task(taskId, status),
        }),
      ),
    swapClient: (next: InspectorClientEventTarget | null) =>
      act(() => rerender(<Probe c={next} />)),
    unmount: () => act(() => unmount()),
  };
}

describe("useTaskToasts", () => {
  beforeEach(() => {
    notificationsMock.show.mockClear();
    notificationsMock.update.mockClear();
    notificationsMock.hide.mockClear();
  });

  it("does nothing without a client", () => {
    function Probe() {
      useTaskToasts(null);
      return null;
    }
    renderWithMantine(<Probe />);
    expect(notificationsMock.show).not.toHaveBeenCalled();
  });

  describe("the progress map", () => {
    it("records a task's progress", () => {
      const h = harness(fakeClient());
      h.taskProgress("t1", 2, 5);
      expect(h.api().progressByTaskId).toEqual({
        t1: { progress: 2, total: 5, message: undefined },
      });
    });

    it("prunes an entry when its task reaches a terminal status", () => {
      const h = harness(fakeClient());
      h.taskProgress("t1", 2, 5);
      h.statusChange("t1", "working");
      h.statusChange("t1", "completed");
      expect(h.api().progressByTaskId).toEqual({});
    });

    it("leaves the map alone when a terminal status names no tracked task", () => {
      const h = harness(fakeClient());
      h.taskProgress("t1", 2, 5);
      const before = h.api().progressByTaskId;
      h.statusChange("t2", "completed");
      expect(h.api().progressByTaskId).toBe(before);
    });

    it("prunes an entry on cancel, tracked or not", () => {
      const h = harness(fakeClient());
      h.taskProgress("t1", 2, 5);
      h.cancelled("t1");
      expect(h.api().progressByTaskId).toEqual({});
      const before = h.api().progressByTaskId;
      h.cancelled("t-unknown");
      expect(h.api().progressByTaskId).toBe(before);
    });

    it("drops every entry on resetTaskProgress", () => {
      const h = harness(fakeClient());
      h.taskProgress("t1", 1);
      h.taskProgress("t2", 1);
      h.run((api) => api.resetTaskProgress());
      expect(h.api().progressByTaskId).toEqual({});
    });
  });

  describe("the status toasts", () => {
    it("shows one non-auto-closing toast for a running task", () => {
      const h = harness(fakeClient());
      h.statusChange("t1", "working");
      expect(notificationsMock.show).toHaveBeenCalledTimes(1);
      expect(notificationsMock.show.mock.calls[0][0]).toMatchObject({
        id: taskToastId("t1"),
        title: "Task working",
        autoClose: false,
      });
    });

    it("replaces that toast on the next tick", () => {
      const h = harness(fakeClient());
      h.statusChange("t1", "working");
      h.requestorUpdate("t1", "input_required");
      expect(notificationsMock.show).toHaveBeenCalledTimes(1);
      expect(notificationsMock.update.mock.calls[0][0]).toMatchObject({
        id: taskToastId("t1"),
        title: "Task input_required",
      });
    });

    it("updates then hides the toast when the task finishes", () => {
      const h = harness(fakeClient());
      h.statusChange("t1", "working");
      h.statusChange("t1", "completed");
      expect(notificationsMock.update).toHaveBeenCalledTimes(1);
      expect(notificationsMock.hide).toHaveBeenCalledWith(taskToastId("t1"));
    });

    it("shows nothing for a task first seen already terminal", () => {
      const h = harness(fakeClient());
      h.statusChange("t1", "completed");
      expect(notificationsMock.show).not.toHaveBeenCalled();
      expect(notificationsMock.update).not.toHaveBeenCalled();
    });

    it("re-shows a task whose toast the user closed", () => {
      const h = harness(fakeClient());
      h.statusChange("t1", "working");
      const { onClose } = notificationsMock.show.mock.calls[0][0] as {
        onClose: () => void;
      };
      onClose();
      h.statusChange("t1", "working");
      expect(notificationsMock.show).toHaveBeenCalledTimes(2);
    });
  });

  describe("cancellation", () => {
    it("converts a live status toast into the cancelled confirmation", () => {
      const h = harness(fakeClient());
      h.statusChange("t1", "working");
      h.cancelled("t1");
      expect(notificationsMock.update).toHaveBeenCalledTimes(1);
      expect(notificationsMock.update.mock.calls[0][0]).toMatchObject({
        id: taskToastId("t1"),
        title: "Task cancelled",
      });
      // Dropped from the live set, so a trailing "cancelled" status tick must
      // not re-show it.
      notificationsMock.show.mockClear();
      h.statusChange("t1", "cancelled");
      expect(notificationsMock.show).not.toHaveBeenCalled();
    });

    it("shows a fresh confirmation when no status toast was open", () => {
      const h = harness(fakeClient());
      h.cancelled("t1");
      expect(notificationsMock.show).toHaveBeenCalledTimes(1);
      expect(notificationsMock.show.mock.calls[0][0]).toMatchObject({
        title: "Task cancelled",
      });
    });
  });

  describe("the in-flight tool-call taskId", () => {
    it("captures the id the client dispatches mid-call", () => {
      const h = harness(fakeClient());
      expect(h.api().activeToolCallTaskIdRef.current).toBeUndefined();
      h.toolCallTask("t1");
      expect(h.api().activeToolCallTaskIdRef.current).toBe("t1");
    });

    it("stops capturing after the client is swapped out", () => {
      const first = fakeClient();
      const h = harness(first);
      h.swapClient(null);
      act(() => {
        first.dispatchTypedEvent("toolCallTaskUpdated", {
          taskId: "t9",
          task: task("t9", "working"),
        });
      });
      expect(h.api().activeToolCallTaskIdRef.current).toBeUndefined();
    });
  });

  describe("teardown", () => {
    it("hides the live toasts when the client is swapped out", () => {
      const h = harness(fakeClient());
      h.statusChange("t1", "working");
      h.swapClient(null);
      expect(notificationsMock.hide).toHaveBeenCalledWith(taskToastId("t1"));
    });

    it("stops listening to the old client after a swap", () => {
      const first = fakeClient();
      const h = harness(first);
      h.swapClient(fakeClient());
      notificationsMock.show.mockClear();
      act(() => {
        first.dispatchTypedEvent("taskStatusChange", {
          taskId: "t1",
          task: task("t1", "working"),
        });
      });
      expect(notificationsMock.show).not.toHaveBeenCalled();
    });

    // #2219: mirrors the `useProgressToasts` case — `hide()` defers `onClose`
    // past the exit transition, and task ids are equally replayable across a
    // reconnect, so the teardown swaps in a fresh Set instead of clearing the
    // one the outgoing toasts' callbacks close over.
    it("keeps the new session's bookkeeping when a hidden toast's onClose fires late", () => {
      const h = harness(fakeClient());
      h.statusChange("t1", "working");
      const { onClose: staleOnClose } = notificationsMock.show.mock
        .calls[0][0] as { onClose: () => void };

      const next = fakeClient();
      h.swapClient(next);
      h.statusChangeOn(next, "t1", "working");
      expect(notificationsMock.show).toHaveBeenCalledTimes(2);

      // The outgoing session's toast finishes its exit transition here.
      staleOnClose();

      h.statusChangeOn(next, "t1", "working");
      expect(notificationsMock.show).toHaveBeenCalledTimes(2);
      expect(notificationsMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: taskToastId("t1") }),
      );
    });

    it("hides the live toasts on unmount", () => {
      const h = harness(fakeClient());
      h.statusChange("t1", "working");
      h.unmount();
      expect(notificationsMock.hide).toHaveBeenCalledWith(taskToastId("t1"));
    });

    it("stops recording progress after the client is swapped out", () => {
      const first = fakeClient();
      const h = harness(first);
      h.swapClient(null);
      act(() => {
        first.dispatchTypedEvent("requestorTaskProgress", {
          taskId: "t1",
          progress: { progress: 1 },
        });
      });
      expect(h.api().progressByTaskId).toEqual({});
    });
  });
});
