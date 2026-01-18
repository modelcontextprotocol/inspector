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
  Menu,
} from '@mantine/core';
import { IconCopy, IconChevronDown, IconDownload } from '@tabler/icons-react';
import { LOG_LEVELS, LOG_LEVEL_COLORS, type LogLevel, type LogEntry } from '@/types/logs';
import { mockLogs } from '@/mocks';

// NOTE: Using local state with mock data instead of storage context.
// Storage solution pending per issue #983.
// Request correlation (View in History) will be enhanced in PR #3.

export function Logs() {
  // Local state for logs (instead of storage context)
  const [logs, setLogs] = useState<LogEntry[]>(mockLogs);

  const [logLevel, setLogLevel] = useState<string | null>('debug');
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  // All 8 RFC 5424 log levels
  const [visibleLevels, setVisibleLevels] = useState({
    debug: true,
    info: true,
    notice: true,
    warning: true,
    error: true,
    critical: true,
    alert: true,
    emergency: true,
  });

  const toggleLevel = (level: string) => {
    setVisibleLevels((prev) => ({ ...prev, [level]: !prev[level as keyof typeof prev] }));
  };

  const filteredLogs = logs.filter((log) => {
    const matchesFilter = filter === '' || log.message.toLowerCase().includes(filter.toLowerCase());
    const matchesLevel = visibleLevels[log.level as keyof typeof visibleLevels] ?? true;
    return matchesFilter && matchesLevel;
  });

  const handleClearLogs = () => {
    if (confirm('Clear all logs?')) {
      setLogs([]);
    }
  };

  // Export as JSON
  const handleExportJson = () => {
    const dataStr = JSON.stringify(logs, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mcp-logs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Export as Text
  const handleExportText = () => {
    const dataStr = logs
      .map((log) => `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');
    const blob = new Blob([dataStr], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mcp-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Copy all logs to clipboard
  const handleCopyAll = () => {
    const text = logs
      .map((log) => `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
  };

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
                  data={LOG_LEVELS.map((level) => ({
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
                      <Text size="sm" tt="uppercase" c={LOG_LEVEL_COLORS[level as LogLevel]}>
                        {level}
                      </Text>
                    }
                  />
                ))}
              </Stack>
            </Stack>

            {/* Actions */}
            <Group gap="sm">
              <Button variant="outline" size="sm" flex={1} onClick={handleClearLogs}>
                Clear
              </Button>
              {/* Export dropdown menu */}
              <Menu shadow="md" width={160}>
                <Menu.Target>
                  <Button
                    variant="outline"
                    size="sm"
                    flex={1}
                    rightSection={<IconChevronDown size={14} />}
                  >
                    Export
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<IconDownload size={14} />}
                    onClick={handleExportJson}
                  >
                    Export as JSON
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconDownload size={14} />}
                    onClick={handleExportText}
                  >
                    Export as Text
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
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
              <Button
                variant="subtle"
                size="sm"
                leftSection={<IconCopy size={14} />}
                onClick={handleCopyAll}
              >
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
                    color={LOG_LEVEL_COLORS[log.level]}
                    variant="light"
                    size="sm"
                    tt="uppercase"
                    style={{ flexShrink: 0 }}
                  >
                    {log.level}
                  </Badge>
                  <Text size="sm" c={LOG_LEVEL_COLORS[log.level]}>
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
