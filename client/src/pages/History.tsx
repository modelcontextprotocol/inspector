import {
  Card,
  Stack,
  Text,
  Title,
  Table,
  Badge,
  Group,
  Button,
  TextInput,
  Select,
} from '@mantine/core';

// Mock history data
const mockHistory = [
  {
    id: 'req-1',
    timestamp: '2025-11-30T14:24:12Z',
    method: 'tools/call',
    target: 'echo',
    duration: 45,
    success: true,
  },
  {
    id: 'req-2',
    timestamp: '2025-11-30T14:23:05Z',
    method: 'tools/list',
    target: null,
    duration: 12,
    success: true,
  },
  {
    id: 'req-3',
    timestamp: '2025-11-30T14:22:00Z',
    method: 'resources/read',
    target: 'file:///config.json',
    duration: 8,
    success: true,
  },
  {
    id: 'req-4',
    timestamp: '2025-11-30T14:21:30Z',
    method: 'prompts/get',
    target: 'greeting_prompt',
    duration: 0,
    success: false,
  },
];

export function History() {
  return (
    <Card h="calc(100vh - 100px)" withBorder>
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={4}>Request History</Title>
          <Group gap="sm">
            <TextInput placeholder="Search..." size="sm" w={200} />
            <Select
              size="sm"
              w={150}
              placeholder="Filter by method"
              clearable
              data={[
                { value: 'tools/call', label: 'tools/call' },
                { value: 'tools/list', label: 'tools/list' },
                { value: 'resources/read', label: 'resources/read' },
                { value: 'prompts/get', label: 'prompts/get' },
              ]}
            />
          </Group>
        </Group>

        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>Method</Table.Th>
              <Table.Th>Target</Table.Th>
              <Table.Th>Duration</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {mockHistory.map((entry) => (
              <Table.Tr key={entry.id}>
                <Table.Td>
                  <Text size="sm" style={{ fontFamily: 'monospace' }}>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" size="sm">
                    {entry.method}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c={entry.target ? undefined : 'dimmed'}>
                    {entry.target || '-'}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{entry.duration}ms</Text>
                </Table.Td>
                <Table.Td>
                  <Badge
                    color={entry.success ? 'green' : 'red'}
                    size="sm"
                  >
                    {entry.success ? 'OK' : 'Error'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Button variant="subtle" size="xs">
                    Replay
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    </Card>
  );
}
