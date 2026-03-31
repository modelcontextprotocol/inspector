import { useState } from "react";
import { Card, Flex, Stack } from "@mantine/core";
import { TaskControls } from "../../groups/TaskControls/TaskControls";
import { TaskListPanel } from "../../groups/TaskListPanel/TaskListPanel";
import type { TaskCardProps } from "../../groups/TaskCard/TaskCard";

export interface TasksScreenProps {
  tasks: TaskCardProps[];
  onRefresh: () => void;
  onClearHistory: () => void;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
  gap: "xl",
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
  onRefresh,
  onClearHistory,
}: TasksScreenProps) {
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>();

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <TaskControls
            searchText={searchText}
            statusFilter={statusFilter}
            onSearchChange={setSearchText}
            onStatusFilterChange={(value) =>
              setStatusFilter(value || undefined)
            }
            onRefresh={onRefresh}
            onClearHistory={onClearHistory}
          />
        </SidebarCard>
      </Sidebar>
      <TaskListPanel
        tasks={tasks}
        searchText={searchText}
        statusFilter={statusFilter}
      />
    </ScreenLayout>
  );
}
