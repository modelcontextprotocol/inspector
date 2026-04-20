import { useState } from "react";
import { Card, Flex, Stack } from "@mantine/core";
import type { Task, TaskStatus } from "@modelcontextprotocol/sdk/types.js";
import { TaskControls } from "../../groups/TaskControls/TaskControls";
import { TaskListPanel } from "../../groups/TaskListPanel/TaskListPanel";
import type { TaskProgress } from "../../groups/TaskCard/TaskCard";

export interface TasksScreenProps {
  tasks: Task[];
  progressByTaskId?: Record<string, TaskProgress>;
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
  onRefresh,
  onClearCompleted,
  onCancel,
}: TasksScreenProps) {
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | undefined>();

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <TaskControls
            searchText={searchText}
            statusFilter={statusFilter}
            onSearchChange={setSearchText}
            onStatusFilterChange={setStatusFilter}
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
