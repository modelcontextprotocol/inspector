import { useMemo, useState } from "react";
import { Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import type { Task, TaskStatus } from "@modelcontextprotocol/client";
import { TaskCard } from "../TaskCard/TaskCard";
import type { TaskProgress } from "../TaskCard/TaskCard";
import { EmbeddableScrollArea } from "../../elements/EmbeddableScrollArea/EmbeddableScrollArea";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import { useScrollMemory } from "../../../hooks/useScrollMemory";

export interface TaskListPanelProps {
  tasks: Task[];
  progressByTaskId?: Record<string, TaskProgress>;
  searchText: string;
  statusFilter?: TaskStatus;
  onCancel: (taskId: string) => void;
  onClearCompleted: () => void;
  /**
   * True when rendered inside the monitoring sidebar. Switches the scroll region
   * from the viewport-height calc to filling its flex parent (via
   * `EmbeddableScrollArea`), so it fits below the column's controls without
   * viewport math (#1616).
   */
  embedded?: boolean;
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

function formatActiveTitle(count: number): string {
  return `Active (${count})`;
}

function formatCompletedTitle(count: number): string {
  return `Completed (${count})`;
}

function isActiveStatus(status: TaskStatus): boolean {
  return status === "working" || status === "input_required";
}

function matchesFilters(
  task: Task,
  searchText: string,
  statusFilter: TaskStatus | undefined,
  // The embedded column exposes only the shared search box (its status filter
  // lives in the full-size sidebar, which the embedded view drops), so it
  // applies the text filter but skips the status filter — mirrors
  // LogStreamPanel's `ignoreLevels` etc. so a stale status filter can't
  // silently hide tasks with no visible control to clear it (#1616).
  ignoreStatus: boolean,
): boolean {
  if (!ignoreStatus && statusFilter && task.status !== statusFilter) {
    return false;
  }
  if (searchText) {
    const term = searchText.toLowerCase();
    const searchable =
      `${task.taskId} ${task.status} ${task.statusMessage ?? ""}`.toLowerCase();
    if (!searchable.includes(term)) return false;
  }
  return true;
}

export function TaskListPanel({
  tasks,
  progressByTaskId,
  searchText,
  statusFilter,
  onCancel,
  onClearCompleted,
  embedded = false,
}: TaskListPanelProps) {
  const viewportRef = useScrollMemory("tasks-list");
  const [compact, setCompact] = useState(false);

  const filteredTasks = useMemo(
    () =>
      tasks.filter((t) =>
        matchesFilters(t, searchText, statusFilter, embedded),
      ),
    [tasks, searchText, statusFilter, embedded],
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
        <EmbeddableScrollArea embedded={embedded} viewportRef={viewportRef}>
          <Stack gap="md">
            {activeTasks.length > 0 && (
              <>
                <Title order={5}>{formatActiveTitle(activeTasks.length)}</Title>
                {activeTasks.map((task) => (
                  <TaskCard
                    key={task.taskId}
                    task={task}
                    progress={progressByTaskId?.[task.taskId]}
                    isListExpanded={!compact}
                    onCancel={() => onCancel(task.taskId)}
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
                    key={task.taskId}
                    task={task}
                    progress={progressByTaskId?.[task.taskId]}
                    isListExpanded={!compact}
                    onCancel={() => onCancel(task.taskId)}
                  />
                ))}
              </>
            )}
          </Stack>
        </EmbeddableScrollArea>
      )}
    </PanelContainer>
  );
}
