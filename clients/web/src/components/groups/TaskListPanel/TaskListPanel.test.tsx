import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { TaskListPanel } from "./TaskListPanel";

const sampleTasks: Task[] = [
  {
    taskId: "task-working-1",
    status: "working",
    ttl: 300000,
    createdAt: "2026-03-29T20:18:20Z",
    lastUpdatedAt: "2026-03-29T20:18:22Z",
    statusMessage: "Synthesizing findings...",
  },
  {
    taskId: "task-input-1",
    status: "input_required",
    ttl: 300000,
    createdAt: "2026-03-29T20:17:55Z",
    lastUpdatedAt: "2026-03-29T20:17:55Z",
  },
  {
    taskId: "task-complete-1",
    status: "completed",
    ttl: 300000,
    createdAt: "2026-03-29T20:16:47Z",
    lastUpdatedAt: "2026-03-29T20:16:51Z",
    statusMessage: "Report generated successfully",
  },
  {
    taskId: "task-failed-1",
    status: "failed",
    ttl: 300000,
    createdAt: "2026-03-29T20:17:27Z",
    lastUpdatedAt: "2026-03-29T20:17:28Z",
    statusMessage: "Connection refused",
  },
];

const baseProps = {
  searchText: "",
  onCancel: vi.fn(),
  onClearCompleted: vi.fn(),
};

describe("TaskListPanel", () => {
  it("renders the title and tasks grouped by active vs completed", () => {
    renderWithMantine(<TaskListPanel {...baseProps} tasks={sampleTasks} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Active (2)")).toBeInTheDocument();
    expect(screen.getByText("Completed (2)")).toBeInTheDocument();
  });

  it("renders the empty state when there are no tasks", () => {
    renderWithMantine(<TaskListPanel {...baseProps} tasks={[]} />);
    expect(screen.getByText("No tasks")).toBeInTheDocument();
  });

  it("renders empty state when status filter eliminates all results", () => {
    renderWithMantine(
      <TaskListPanel
        {...baseProps}
        tasks={sampleTasks}
        statusFilter="cancelled"
      />,
    );
    expect(screen.getByText("No tasks")).toBeInTheDocument();
  });

  it("filters tasks by status filter", () => {
    renderWithMantine(
      <TaskListPanel
        {...baseProps}
        tasks={sampleTasks}
        statusFilter="working"
      />,
    );
    expect(screen.getByText("Active (1)")).toBeInTheDocument();
    expect(screen.queryByText(/^Completed/)).not.toBeInTheDocument();
  });

  it("filters tasks by search text matching statusMessage", () => {
    renderWithMantine(
      <TaskListPanel
        {...baseProps}
        tasks={sampleTasks}
        searchText="Connection"
      />,
    );
    expect(screen.getByText("Completed (1)")).toBeInTheDocument();
    expect(screen.queryByText(/^Active/)).not.toBeInTheDocument();
  });

  it("filters tasks by taskId", () => {
    renderWithMantine(
      <TaskListPanel
        {...baseProps}
        tasks={sampleTasks}
        searchText="task-input-1"
      />,
    );
    expect(screen.getByText("Active (1)")).toBeInTheDocument();
  });

  it("invokes onClearCompleted when Clear is clicked", async () => {
    const user = userEvent.setup();
    const onClearCompleted = vi.fn();
    renderWithMantine(
      <TaskListPanel
        {...baseProps}
        tasks={sampleTasks}
        onClearCompleted={onClearCompleted}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClearCompleted).toHaveBeenCalledTimes(1);
  });

  it("invokes onCancel with the taskId when Cancel Task is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithMantine(
      <TaskListPanel
        {...baseProps}
        tasks={[sampleTasks[0]]}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel Task" }));
    expect(onCancel).toHaveBeenCalledWith("task-working-1");
  });

  it("renders only the completed section when no active tasks remain", () => {
    renderWithMantine(
      <TaskListPanel {...baseProps} tasks={[sampleTasks[2], sampleTasks[3]]} />,
    );
    expect(screen.getByText("Completed (2)")).toBeInTheDocument();
    expect(screen.queryByText(/^Active/)).not.toBeInTheDocument();
  });

  it("renders only the active section when no completed tasks remain", () => {
    renderWithMantine(
      <TaskListPanel {...baseProps} tasks={[sampleTasks[0], sampleTasks[1]]} />,
    );
    expect(screen.getByText("Active (2)")).toBeInTheDocument();
    expect(screen.queryByText(/^Completed/)).not.toBeInTheDocument();
  });

  it("forwards progress to the matching active TaskCard", () => {
    renderWithMantine(
      <TaskListPanel
        {...baseProps}
        tasks={[sampleTasks[0]]}
        progressByTaskId={{
          "task-working-1": { progress: 3, total: 10, message: "Step 3" },
        }}
      />,
    );
    expect(screen.getByText("Step 3")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  it("toggles compact mode through the ListToggle", async () => {
    const user = userEvent.setup();
    renderWithMantine(<TaskListPanel {...baseProps} tasks={sampleTasks} />);
    // Initially expanded — Collapse buttons are present
    expect(
      screen.getAllByRole("button", { name: "Collapse" }).length,
    ).toBeGreaterThan(0);

    const buttons = screen.getAllByRole("button");
    const toggle = buttons.find(
      (b) =>
        b.textContent === "" && b.classList.contains("mantine-Button-root"),
    );
    expect(toggle).toBeDefined();
    await user.click(toggle!);

    // After toggle, entries collapsed — they show Expand
    expect(
      screen.getAllByRole("button", { name: "Expand" }).length,
    ).toBeGreaterThan(0);
  });
});
