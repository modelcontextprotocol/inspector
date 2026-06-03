import { Card, Flex, Stack } from "@mantine/core";
import type { Task, TaskStatus } from "@modelcontextprotocol/sdk/types.js";
import { TaskControls } from "../../groups/TaskControls/TaskControls";
import { TaskListPanel } from "../../groups/TaskListPanel/TaskListPanel";
import type { TaskProgress } from "../../groups/TaskCard/TaskCard";

export interface TasksScreenProps {
  tasks: Task[];
  progressByTaskId?: Record<string, TaskProgress>;
  // Search + status filter are controlled by the parent (App) so they persist
  // across tab navigation within a live session — see #1417.
  searchText?: string;
  statusFilter?: TaskStatus;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: TaskStatus | undefined) => void;
  onRefresh: () => void;
  onClearCompleted: () => void;
  onCancel: (taskId: string) => void;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
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
  searchText = "",
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onRefresh,
  onClearCompleted,
  onCancel,
}: TasksScreenProps) {
  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <TaskControls
            searchText={searchText}
            statusFilter={statusFilter}
            onSearchChange={onSearchChange}
            onStatusFilterChange={onStatusFilterChange}
            onRefresh={onRefresh}
          />
        </SidebarCard>
      </Sidebar>
      <TaskListPanel
        tasks={tasks}
        progressByTaskId={progressByTaskId}
        searchText={searchText}
        statusFilter={statusFilter}
        onCancel={onCancel}
        onClearCompleted={onClearCompleted}
      />
    </ScreenLayout>
  );
}
