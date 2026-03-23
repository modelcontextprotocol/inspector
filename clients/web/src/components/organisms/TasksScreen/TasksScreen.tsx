import { Button, Container, Group, Stack, Text, Title } from "@mantine/core";
import { TaskCard } from "../../molecules/TaskCard/TaskCard";
import type { TaskCardProps } from "../../molecules/TaskCard/TaskCard";

export interface TasksScreenProps {
  activeTasks: TaskCardProps[];
  completedTasks: TaskCardProps[];
  onRefresh: () => void;
  onClearHistory: () => void;
}

export function TasksScreen({
  activeTasks,
  completedTasks,
  onRefresh,
  onClearHistory,
}: TasksScreenProps) {
  return (
    <Container size="xl" py="xl">
    <Stack gap="lg">
      <Group justify="flex-end">
        <Button variant="dark" onClick={onRefresh}>
          Refresh Tasks
        </Button>
      </Group>

      <Title order={4}>Active Tasks ({activeTasks.length})</Title>
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
        <Title order={4}>Completed Tasks ({completedTasks.length})</Title>
        {completedTasks.length > 0 && (
          <Button variant="light" size="xs" onClick={onClearHistory}>
            Clear History
          </Button>
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
    </Container>
  );
}
