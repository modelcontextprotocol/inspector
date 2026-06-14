import { Card, Flex, Stack } from "@mantine/core";
import type { Task, TaskStatus } from "@modelcontextprotocol/sdk/types.js";
import { TaskControls } from "../../groups/TaskControls/TaskControls";
import { TaskListPanel } from "../../groups/TaskListPanel/TaskListPanel";
import type { TaskProgress } from "../../groups/TaskCard/TaskCard";

export interface TasksScreenProps {
  tasks: Task[];
  progressByTaskId?: Record<string, TaskProgress>;
  ui: TasksUiState;
  onUiChange: (next: TasksUiState) => void;
  onRefresh: () => void;
  onClearCompleted: () => void;
  onCancel: (taskId: string) => void;
}

// Search + status filter — controlled by the parent (App) as one object so they
// persist across tab navigation within a live session (#1417).
export interface TasksUiState {
  search: string;
  statusFilter?: TaskStatus;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100dvh - var(--app-shell-header-height, 0px))",
  gap: "md",
  p: "xl",
});

const Sidebar = Stack.withProps({
  w: 340,
  flex: "0 0 auto",
});

const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

export function TasksScreen({
  tasks,
  progressByTaskId,
  ui,
  onUiChange,
  onRefresh,
  onClearCompleted,
  onCancel,
}: TasksScreenProps) {
  const { search, statusFilter } = ui;
  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <TaskControls
            searchText={search}
            statusFilter={statusFilter}
            onSearchChange={(value) => onUiChange({ ...ui, search: value })}
            onStatusFilterChange={(value) =>
              onUiChange({ ...ui, statusFilter: value })
            }
            onRefresh={onRefresh}
          />
        </SidebarCard>
      </Sidebar>
      <TaskListPanel
        tasks={tasks}
        progressByTaskId={progressByTaskId}
        searchText={search}
        statusFilter={statusFilter}
        onCancel={onCancel}
        onClearCompleted={onClearCompleted}
      />
    </ScreenLayout>
  );
}
