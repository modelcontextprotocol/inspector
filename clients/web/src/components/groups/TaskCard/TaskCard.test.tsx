import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { TaskCard } from "./TaskCard";

const workingTask: Task = {
  taskId: "task-working-1",
  status: "working",
  ttl: 300000,
  createdAt: "2026-03-29T20:18:20Z",
  lastUpdatedAt: "2026-03-29T20:18:22Z",
  statusMessage: "Synthesizing findings...",
};

const inputRequiredTask: Task = {
  taskId: "task-input-1",
  status: "input_required",
  ttl: 300000,
  createdAt: "2026-03-29T20:17:55Z",
  lastUpdatedAt: "2026-03-29T20:17:55Z",
  statusMessage: "Waiting for confirmation",
};

const completedTask: Task = {
  taskId: "task-complete-1",
  status: "completed",
  ttl: null,
  createdAt: "2026-03-29T20:16:47Z",
  lastUpdatedAt: "2026-03-29T20:16:51Z",
  statusMessage: "Report generated successfully",
};

const cancelledTask: Task = {
  taskId: "task-cancel-1",
  status: "cancelled",
  ttl: 300000,
  createdAt: "2026-03-29T20:18:15Z",
  lastUpdatedAt: "2026-03-29T20:18:18Z",
};

describe("TaskCard", () => {
  it("renders the task id, status, and details", () => {
    renderWithMantine(
      <TaskCard task={workingTask} isListExpanded={false} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("ID: task-working-1")).toBeInTheDocument();
    expect(screen.getByText("working")).toBeInTheDocument();
    expect(screen.getByText("2026-03-29T20:18:20Z")).toBeInTheDocument();
    expect(screen.getByText("2026-03-29T20:18:22Z")).toBeInTheDocument();
    expect(screen.getByText("300000ms")).toBeInTheDocument();
  });

  it("renders the Cancel Task button when status is working", () => {
    renderWithMantine(
      <TaskCard task={workingTask} isListExpanded={false} onCancel={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "Cancel Task" }),
    ).toBeInTheDocument();
  });

  it("renders the Cancel Task button when status is input_required", () => {
    renderWithMantine(
      <TaskCard
        task={inputRequiredTask}
        isListExpanded={false}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Cancel Task" }),
    ).toBeInTheDocument();
    expect(screen.getByText("input required")).toBeInTheDocument();
  });

  it("does not render Cancel Task button for completed tasks", () => {
    renderWithMantine(
      <TaskCard
        task={completedTask}
        isListExpanded={false}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Cancel Task" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("invokes onCancel when Cancel Task is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithMantine(
      <TaskCard
        task={workingTask}
        isListExpanded={false}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel Task" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders the status message when no progress is provided", () => {
    renderWithMantine(
      <TaskCard task={workingTask} isListExpanded={false} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Synthesizing findings...")).toBeInTheDocument();
  });

  it("renders the progress display when active and progress is provided", () => {
    renderWithMantine(
      <TaskCard
        task={workingTask}
        progress={{ progress: 5, total: 10, message: "Half-way" }}
        isListExpanded={false}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Half-way")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    // status message should NOT show when progress is shown
    expect(
      screen.queryByText("Synthesizing findings..."),
    ).not.toBeInTheDocument();
  });

  it("does not render TTL row when ttl is null", () => {
    renderWithMantine(
      <TaskCard
        task={completedTask}
        isListExpanded={false}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText("TTL")).not.toBeInTheDocument();
  });

  it("does not render status message section when statusMessage is undefined", () => {
    renderWithMantine(
      <TaskCard
        task={cancelledTask}
        isListExpanded={false}
        onCancel={vi.fn()}
      />,
    );
    // Cancelled, no progress, no statusMessage — neither block renders.
    expect(screen.getByText("cancelled")).toBeInTheDocument();
  });

  it("toggles between Expand and Collapse when the toggle button is clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <TaskCard task={workingTask} isListExpanded={false} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("starts expanded when isListExpanded is true and shows the full task object section", () => {
    renderWithMantine(
      <TaskCard task={workingTask} isListExpanded={true} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Full Task Object")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("syncs local expanded state when isListExpanded prop changes", () => {
    const { rerender } = renderWithMantine(
      <TaskCard task={workingTask} isListExpanded={false} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    rerender(
      <TaskCard task={workingTask} isListExpanded={true} onCancel={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });
});
