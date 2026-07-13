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
  /**
   * True when rendered inside the monitoring sidebar: the screen fills its
   * parent's height (instead of the viewport calc) and drops the filter
   * sidebar so the narrow column is list-only. Mirrors `LoggingScreen`.
   */
  embedded?: boolean;
}

// Search + status filter — controlled by the parent (App) as one object so they
// persist across tab navigation within a live session (#1417).
export interface TasksUiState {
  search: string;
  statusFilter?: TaskStatus;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100dvh - var(--app-shell-header-height, 0px) - var(--app-shell-footer-height, 0px))",
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
  embedded = false,
}: TasksScreenProps) {
  const { search, statusFilter } = ui;
  return (
    // Embedded fills the monitoring sidebar column (100%); standalone keeps the
    // ScreenLayout's default full-screen height. Only override `h` when embedded
    // — passing `h={undefined}` would clobber the default (withProps spreads).
    <ScreenLayout {...(embedded ? { h: "100%" } : {})}>
      {embedded ? null : (
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
      )}
      <TaskListPanel
        tasks={tasks}
        progressByTaskId={progressByTaskId}
        searchText={search}
        statusFilter={statusFilter}
        onCancel={onCancel}
        onClearCompleted={onClearCompleted}
        embedded={embedded}
      />
    </ScreenLayout>
  );
}
