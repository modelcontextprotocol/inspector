import {
  Card,
  Stack,
  Text,
  Title,
  Badge,
  Progress,
  Group,
  Button,
} from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

// Mock tasks data
const mockActiveTasks = [
  {
    id: 'abc-123',
    method: 'tools/call',
    name: 'longRunningOperation',
    status: 'running',
    progress: 80,
    progressMessage: 'Processing batch 4 of 5...',
    startedAt: '2025-11-30T14:32:05Z',
  },
  {
    id: 'def-456',
    method: 'resources/read',
    name: 'large-dataset',
    status: 'waiting',
    progress: 0,
    progressMessage: null,
    startedAt: '2025-11-30T14:33:00Z',
  },
];

const mockCompletedTasks = [
  {
    id: 'ghi-789',
    method: 'tools/call',
    name: 'processData',
    status: 'completed',
    progress: 100,
    startedAt: '2025-11-30T14:30:00Z',
    completedAt: '2025-11-30T14:31:30Z',
  },
  {
    id: 'jkl-012',
    method: 'resources/read',
    name: 'config-file',
    status: 'failed',
    progress: 45,
    error: 'Resource not found',
    startedAt: '2025-11-30T14:28:00Z',
    completedAt: '2025-11-30T14:28:15Z',
  },
];

const statusColors: Record<string, string> = {
  waiting: 'gray',
  running: 'blue',
  completed: 'green',
  failed: 'red',
  cancelled: 'orange',
};

function formatElapsed(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatDuration(startedAt: string, completedAt: string): string {
  return formatElapsed(startedAt, completedAt);
}

interface TaskCardProps {
  task: {
    id: string;
    method: string;
    name: string;
    status: string;
    progress: number;
    progressMessage?: string | null;
    startedAt: string;
    completedAt?: string;
    error?: string;
  };
  showActions?: boolean;
}

function TaskCard({ task, showActions = true }: TaskCardProps) {
  const isActive = task.status === 'running' || task.status === 'waiting';
  const isCompleted = task.status === 'completed';
  const isFailed = task.status === 'failed';

  return (
    <Card withBorder>
      <Stack gap="sm" p="md">
        {/* Header */}
        <Group justify="space-between">
          <Group gap="sm">
            <Text size="sm" c="dimmed" ff="monospace">
              Task: {task.id}
            </Text>
            <Badge color={statusColors[task.status]} size="sm">
              {task.status}
            </Badge>
          </Group>
          <Group gap="sm">
            <Progress value={task.progress} size="sm" w={96} />
            <Text size="sm" c="dimmed" w={40} ta="right">
              {task.progress}%
            </Text>
          </Group>
        </Group>

        {/* Details */}
        <Stack gap={4}>
          <Text size="sm">
            <Text span c="dimmed">Method:</Text> {task.method}
          </Text>
          <Text size="sm">
            <Text span c="dimmed">
              {task.method === 'tools/call' ? 'Tool:' : 'Resource:'}
            </Text>{' '}
            {task.name}
          </Text>
          <Text size="sm">
            <Text span c="dimmed">
              {isActive ? 'Started:' : 'Completed:'}
            </Text>{' '}
            {new Date(task.completedAt || task.startedAt).toLocaleTimeString()}
            <Text span c="dimmed" ml="md">
              {isActive ? 'Elapsed:' : 'Duration:'}
            </Text>{' '}
            {isActive
              ? formatElapsed(task.startedAt)
              : formatDuration(task.startedAt, task.completedAt!)}
          </Text>
          {task.progressMessage && (
            <Text size="sm" c="dimmed">
              Progress: {task.progressMessage}
            </Text>
          )}
          {isFailed && task.error && (
            <Text size="sm" c="red">
              Error: {task.error}
            </Text>
          )}
        </Stack>

        {/* Actions */}
        {showActions && (
          <Group justify="flex-end" gap="sm" pt="xs">
            <Button variant="subtle" size="xs">
              {isCompleted || isFailed ? 'View Result' : 'View Details'}
            </Button>
            {isActive ? (
              <Button variant="subtle" size="xs" c="red">
                Cancel
              </Button>
            ) : (
              <Button variant="subtle" size="xs">
                Dismiss
              </Button>
            )}
          </Group>
        )}
      </Stack>
    </Card>
  );
}

export function Tasks() {
  return (
    <Stack gap="lg">
      {/* Header */}
      <Group justify="space-between">
        <Title order={2}>Tasks</Title>
        <Button variant="outline" size="sm" leftSection={<IconRefresh size={16} />}>
          Refresh
        </Button>
      </Group>

      {/* Active Tasks */}
      <Stack gap="sm">
        <Title order={4}>Active Tasks ({mockActiveTasks.length})</Title>
        {mockActiveTasks.length === 0 ? (
          <Card withBorder>
            <Text c="dimmed" ta="center" py="xl">
              No active tasks
            </Text>
          </Card>
        ) : (
          <Stack gap="sm">
            {mockActiveTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </Stack>
        )}
      </Stack>

      {/* Completed Tasks */}
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={4}>Completed Tasks ({mockCompletedTasks.length})</Title>
          <Button variant="subtle" size="xs">
            Clear History
          </Button>
        </Group>
        {mockCompletedTasks.length === 0 ? (
          <Card withBorder>
            <Text c="dimmed" ta="center" py="xl">
              No completed tasks
            </Text>
          </Card>
        ) : (
          <Stack gap="sm">
            {mockCompletedTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
