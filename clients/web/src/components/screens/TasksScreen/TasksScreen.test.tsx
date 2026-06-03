import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Task } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { TasksScreen } from "./TasksScreen";
import { EMPTY_TASKS_UI } from "../screenUiState";

const tasks: Task[] = [
  {
    taskId: "t1",
    status: "working",
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    pollInterval: 1000,
    ttl: 60000,
  },
];

const baseProps = {
  tasks,
  ui: EMPTY_TASKS_UI,
  onUiChange: vi.fn(),
  onRefresh: vi.fn(),
  onClearCompleted: vi.fn(),
  onCancel: vi.fn(),
};

describe("TasksScreen", () => {
  it("renders the controls and list", () => {
    renderWithMantine(<TasksScreen {...baseProps} />);
    expect(screen.getAllByText("Tasks").length).toBeGreaterThan(0);
  });

  it("renders an empty list when no tasks are provided", () => {
    renderWithMantine(<TasksScreen {...baseProps} tasks={[]} />);
    expect(screen.getAllByText("Tasks").length).toBeGreaterThan(0);
  });

  it("invokes onRefresh when refresh is clicked", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    renderWithMantine(<TasksScreen {...baseProps} onRefresh={onRefresh} />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("emits the search text through onUiChange", async () => {
    const user = userEvent.setup();
    const onUiChange = vi.fn();
    renderWithMantine(<TasksScreen {...baseProps} onUiChange={onUiChange} />);
    await user.type(screen.getByPlaceholderText("Search..."), "x");
    expect(onUiChange).toHaveBeenCalledWith(
      expect.objectContaining({ search: "x" }),
    );
  });

  it("emits the cleared status filter through onUiChange", async () => {
    const user = userEvent.setup();
    const onUiChange = vi.fn();
    const { container } = renderWithMantine(
      <TasksScreen
        {...baseProps}
        ui={{ ...EMPTY_TASKS_UI, statusFilter: "working" }}
        onUiChange={onUiChange}
      />,
    );
    const clearButton = container.querySelector(
      "button.mantine-InputClearButton-root",
    ) as HTMLButtonElement | null;
    expect(clearButton).not.toBeNull();
    await user.click(clearButton!);
    expect(onUiChange).toHaveBeenCalledWith(
      expect.objectContaining({ statusFilter: undefined }),
    );
  });
});
