import {
  Card,
  Stack,
  Select,
  ScrollArea,
  Text,
  Code,
  Group,
  Title,
} from '@mantine/core';

// Mock log entries
const mockLogs = [
  { timestamp: '2025-11-30T14:23:01Z', level: 'info', message: 'Server connected' },
  { timestamp: '2025-11-30T14:23:05Z', level: 'debug', message: 'Sending tools/list request' },
  { timestamp: '2025-11-30T14:23:05Z', level: 'debug', message: 'Received tools/list response: 4 tools' },
  { timestamp: '2025-11-30T14:24:12Z', level: 'info', message: 'Tool echo executed successfully' },
  { timestamp: '2025-11-30T14:25:30Z', level: 'warning', message: 'Request timeout approaching' },
];

const levelColors: Record<string, string> = {
  debug: 'gray',
  info: 'blue',
  warning: 'yellow',
  error: 'red',
};

export function Logs() {
  return (
    <Card h="calc(100vh - 100px)" withBorder>
      <Stack gap="md" h="100%">
        <Group justify="space-between">
          <Title order={4}>Server Logs</Title>
          <Select
            size="sm"
            w={150}
            defaultValue="debug"
            data={[
              { value: 'debug', label: 'Debug' },
              { value: 'info', label: 'Info' },
              { value: 'warning', label: 'Warning' },
              { value: 'error', label: 'Error' },
            ]}
          />
        </Group>

        <ScrollArea h="calc(100% - 60px)">
          <Stack gap="xs">
            {mockLogs.map((log, index) => (
              <Group key={index} gap="sm" wrap="nowrap">
                <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </Text>
                <Code
                  color={levelColors[log.level]}
                  style={{ textTransform: 'uppercase' }}
                >
                  {log.level}
                </Code>
                <Text size="sm">{log.message}</Text>
              </Group>
            ))}
          </Stack>
        </ScrollArea>
      </Stack>
    </Card>
  );
}
