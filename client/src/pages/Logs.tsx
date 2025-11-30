import { useState } from 'react';
import {
  Card,
  Stack,
  Select,
  ScrollArea,
  Text,
  Grid,
  Group,
  Badge,
  Button,
  TextInput,
  Checkbox,
} from '@mantine/core';
import { IconCopy } from '@tabler/icons-react';

// Mock log entries
const mockLogs = [
  { timestamp: '2025-11-30T14:23:01Z', level: 'info', message: 'Server connected', logger: 'connection' },
  { timestamp: '2025-11-30T14:23:05Z', level: 'debug', message: 'Sending tools/list request', logger: 'protocol' },
  { timestamp: '2025-11-30T14:23:05Z', level: 'debug', message: 'Received tools/list response: 4 tools', logger: 'protocol' },
  { timestamp: '2025-11-30T14:24:12Z', level: 'info', message: 'Tool echo executed successfully', logger: 'tools' },
  { timestamp: '2025-11-30T14:25:30Z', level: 'warning', message: 'Request timeout approaching', logger: 'connection' },
  { timestamp: '2025-11-30T14:26:00Z', level: 'error', message: 'Failed to fetch resource: 404', logger: 'resources' },
];

const logLevels = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

const levelColors: Record<string, string> = {
  debug: 'gray',
  info: 'blue',
  notice: 'cyan',
  warning: 'yellow',
  error: 'red',
  critical: 'red',
  alert: 'red',
  emergency: 'red',
};

export function Logs() {
  const [logLevel, setLogLevel] = useState<string | null>('debug');
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [visibleLevels, setVisibleLevels] = useState({
    debug: true,
    info: true,
    warning: true,
    error: true,
  });

  const toggleLevel = (level: string) => {
    setVisibleLevels((prev) => ({ ...prev, [level]: !prev[level as keyof typeof prev] }));
  };

  const filteredLogs = mockLogs.filter((log) => {
    const matchesFilter = filter === '' || log.message.toLowerCase().includes(filter.toLowerCase());
    const matchesLevel = visibleLevels[log.level as keyof typeof visibleLevels] ?? true;
    return matchesFilter && matchesLevel;
  });

  return (
    <Grid gutter="md" h="calc(100vh - 120px)">
      {/* Left Panel - Controls (25%) */}
      <Grid.Col span={3}>
        <Card withBorder h="100%">
          <Stack gap="lg" p="md">
            {/* Log Level */}
            <Stack gap="xs">
              <Text size="sm" fw={500}>Log Level</Text>
              <Group gap="sm">
                <Select
                  flex={1}
                  size="sm"
                  value={logLevel}
                  onChange={setLogLevel}
                  data={logLevels.map((level) => ({
                    value: level,
                    label: level.charAt(0).toUpperCase() + level.slice(1),
                  }))}
                />
                <Button size="sm">Set Level</Button>
              </Group>
            </Stack>

            {/* Text Filter */}
            <Stack gap="xs">
              <Text size="sm" fw={500}>Filter</Text>
              <TextInput
                placeholder="Search logs..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </Stack>

            {/* Level Checkboxes */}
            <Stack gap="xs">
              <Text size="sm" fw={500}>Show Levels</Text>
              <Stack gap="xs">
                {Object.entries(visibleLevels).map(([level, checked]) => (
                  <Checkbox
                    key={level}
                    checked={checked}
                    onChange={() => toggleLevel(level)}
                    label={
                      <Text size="sm" tt="uppercase" c={levelColors[level]}>
                        {level}
                      </Text>
                    }
                  />
                ))}
              </Stack>
            </Stack>

            {/* Actions */}
            <Group gap="sm">
              <Button variant="outline" size="sm" flex={1}>
                Clear
              </Button>
              <Button variant="outline" size="sm" flex={1}>
                Export
              </Button>
            </Group>
          </Stack>
        </Card>
      </Grid.Col>

      {/* Right Panel - Log Stream (75%) */}
      <Grid.Col span={9}>
        <Card withBorder h="100%" style={{ display: 'flex', flexDirection: 'column' }}>
          <Group justify="space-between" p="md" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Text fw={600}>Log Stream</Text>
            <Group gap="lg">
              <Checkbox
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.currentTarget.checked)}
                label={<Text size="sm">Auto-scroll</Text>}
              />
              <Button variant="subtle" size="sm" leftSection={<IconCopy size={14} />}>
                Copy All
              </Button>
            </Group>
          </Group>
          <ScrollArea flex={1} p="md">
            <Stack gap={4} style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
              {filteredLogs.map((log, index) => (
                <Group key={index} gap="sm" wrap="nowrap" align="flex-start">
                  <Text c="dimmed" size="sm" style={{ flexShrink: 0 }}>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </Text>
                  <Badge
                    color={levelColors[log.level]}
                    variant="light"
                    size="sm"
                    tt="uppercase"
                    style={{ flexShrink: 0 }}
                  >
                    {log.level}
                  </Badge>
                  <Text size="sm" c={levelColors[log.level]}>
                    {log.message}
                  </Text>
                </Group>
              ))}
            </Stack>
          </ScrollArea>
        </Card>
      </Grid.Col>
    </Grid>
  );
}
