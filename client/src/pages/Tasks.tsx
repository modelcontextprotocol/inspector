import {
  Card,
  Stack,
  Text,
  Title,
  Table,
  Badge,
  Progress,
  Group,
} from '@mantine/core';

// Mock tasks data
const mockTasks = [
  {
    id: 'task-1',
    name: 'longRunningOperation',
    status: 'running',
    progress: 45,
    startedAt: '2025-11-30T14:24:00Z',
  },
  {
    id: 'task-2',
    name: 'dataSync',
    status: 'completed',
    progress: 100,
    startedAt: '2025-11-30T14:20:00Z',
    completedAt: '2025-11-30T14:22:30Z',
  },
];

const statusColors: Record<string, string> = {
  pending: 'gray',
  running: 'blue',
  completed: 'green',
  failed: 'red',
  cancelled: 'orange',
};

export function Tasks() {
  return (
    <Card h="calc(100vh - 100px)" withBorder>
      <Stack gap="md">
        <Title order={4}>Background Tasks</Title>

        {mockTasks.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">
            No active tasks
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Task</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Progress</Table.Th>
                <Table.Th>Started</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {mockTasks.map((task) => (
                <Table.Tr key={task.id}>
                  <Table.Td>{task.name}</Table.Td>
                  <Table.Td>
                    <Badge color={statusColors[task.status]} size="sm">
                      {task.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td w={150}>
                    <Group gap="xs">
                      <Progress value={task.progress} size="sm" style={{ flex: 1 }} />
                      <Text size="xs">{task.progress}%</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {new Date(task.startedAt).toLocaleTimeString()}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Card>
  );
}
