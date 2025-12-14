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
import { mockLogs, logLevels, levelColors } from '@/mocks';

export function Logs() {
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

  const filteredLogs = mockLogs.filter((log) => {
    const matchesFilter = filter === '' || log.message.toLowerCase().includes(filter.toLowerCase());
    const matchesLevel = visibleLevels[log.level as keyof typeof visibleLevels] ?? true;
    return matchesFilter && matchesLevel;
  });

  // Export as JSON
  const handleExportJson = () => {
    const exportData = filteredLogs.map((log) => ({
      timestamp: log.timestamp,
      level: log.level,
      message: log.message,
      logger: log.logger,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
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
    const lines = filteredLogs.map(
      (log) => `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.logger}] ${log.message}`
    );
    const blob = new Blob([lines.join('\n')], {
      type: 'text/plain',
    });
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
    const lines = filteredLogs.map(
      (log) => `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.logger}] ${log.message}`
    );
    navigator.clipboard.writeText(lines.join('\n'));
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
