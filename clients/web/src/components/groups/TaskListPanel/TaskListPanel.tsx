import { useMemo, useState } from "react";
import {
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { TaskCard } from "../TaskCard/TaskCard";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import type { TaskCardProps } from "../TaskCard/TaskCard";

export interface TaskListPanelProps {
  tasks: TaskCardProps[];
  searchText: string;
  statusFilter?: string;
  onClearCompleted: () => void;
}

const PanelContainer = Paper.withProps({
  withBorder: true,
  p: "lg",
  flex: 1,
  variant: "panel",
});

const ClearHistoryButton = Button.withProps({
  variant: "subtle",
  size: "sm",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

function taskKey(task: TaskCardProps): string {
  return task.taskId;
}

function formatActiveTitle(count: number): string {
  return `Active (${count})`;
}

function formatCompletedTitle(count: number): string {
  return `Completed (${count})`;
}

function isActiveStatus(status: string): boolean {
  return status === "working" || status === "input_required";
}

function matchesFilters(
  task: TaskCardProps,
  searchText: string,
  statusFilter?: string,
): boolean {
  if (statusFilter && task.status !== statusFilter) return false;
  if (searchText) {
    const term = searchText.toLowerCase();
    const searchable =
      `${task.taskId} ${task.method} ${task.target ?? ""} ${task.status}`.toLowerCase();
    if (!searchable.includes(term)) return false;
  }
  return true;
}

export function TaskListPanel({
  tasks,
  searchText,
  statusFilter,
  onClearCompleted,
}: TaskListPanelProps) {
  const [compact, setCompact] = useState(false);

  const filteredTasks = useMemo(
    () => tasks.filter((t) => matchesFilters(t, searchText, statusFilter)),
    [tasks, searchText, statusFilter],
  );

  const activeTasks = useMemo(
    () => filteredTasks.filter((t) => isActiveStatus(t.status)),
    [filteredTasks],
  );

  const completedTasks = useMemo(
    () => filteredTasks.filter((t) => !isActiveStatus(t.status)),
    [filteredTasks],
  );

  const hasResults = filteredTasks.length > 0;

  return (
    <PanelContainer>
      <Group justify="space-between" mb="sm">
        <Title order={4}>Tasks</Title>
        {hasResults && (
          <ListToggle
            compact={compact}
            onToggle={() => setCompact((c) => !c)}
          />
        )}
      </Group>

      {!hasResults ? (
        <EmptyState>No tasks</EmptyState>
      ) : (
        <ScrollArea.Autosize mah="calc(100vh - var(--app-shell-header-height, 0px) - 150px)">
          <Stack gap="md">
            {activeTasks.length > 0 && (
              <>
                <Title order={5}>{formatActiveTitle(activeTasks.length)}</Title>
                {activeTasks.map((task) => (
                  <TaskCard
                    key={taskKey(task)}
                    {...task}
                    isListExpanded={!compact}
                  />
                ))}
              </>
            )}

            {completedTasks.length > 0 && (
              <>
                <Group justify="space-between">
                  <Title order={5}>
                    {formatCompletedTitle(completedTasks.length)}
                  </Title>
                  <ClearHistoryButton onClick={onClearCompleted}>
                    Clear
                  </ClearHistoryButton>
                </Group>
                {completedTasks.map((task) => (
                  <TaskCard
                    key={taskKey(task)}
                    {...task}
                    isListExpanded={!compact}
                  />
                ))}
              </>
            )}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </PanelContainer>
  );
}
