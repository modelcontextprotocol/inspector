import {
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { TaskCard } from "../../groups/TaskCard/TaskCard";
import type { TaskCardProps } from "../../groups/TaskCard/TaskCard";

export interface TasksScreenProps {
  activeTasks: TaskCardProps[];
  completedTasks: TaskCardProps[];
  onRefresh: () => void;
  onClearHistory: () => void;
}

const PageContainer = Container.withProps({
  size: "xl",
  py: "xl",
});

const ContentPanel = Paper.withProps({
  withBorder: true,
  p: "md",
});

const CompactButton = Button.withProps({
  variant: "light",
  size: "xs",
});

function formatSectionTitle(label: string, count: number): string {
  return `${label} (${count})`;
}

export function TasksScreen({
  activeTasks,
  completedTasks,
  onRefresh,
  onClearHistory,
}: TasksScreenProps) {
  return (
    <PageContainer>
      <ContentPanel>
        <Stack gap="lg">
          <Group justify="space-between">
            <Title order={4}>
              {formatSectionTitle("Active Tasks", activeTasks.length)}
            </Title>
            <CompactButton onClick={onRefresh}>Refresh Tasks</CompactButton>
          </Group>
          {activeTasks.length === 0 ? (
            <Text c="dimmed">No active tasks</Text>
          ) : (
            <Stack gap="md">
              {activeTasks.map((task) => (
                <TaskCard key={task.taskId} {...task} />
              ))}
            </Stack>
          )}

          <Group justify="space-between">
            <Title order={4}>
              {formatSectionTitle("Completed Tasks", completedTasks.length)}
            </Title>
            {completedTasks.length > 0 && (
              <CompactButton onClick={onClearHistory}>
                Clear History
              </CompactButton>
            )}
          </Group>
          {completedTasks.length === 0 ? (
            <Text c="dimmed">No completed tasks</Text>
          ) : (
            <Stack gap="md">
              {completedTasks.map((task) => (
                <TaskCard key={task.taskId} {...task} />
              ))}
            </Stack>
          )}
        </Stack>
      </ContentPanel>
    </PageContainer>
  );
}
