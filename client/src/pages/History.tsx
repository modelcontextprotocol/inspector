import { useState } from 'react';
import {
  Card,
  Stack,
  Text,
  Title,
  Badge,
  Group,
  Button,
  TextInput,
  Select,
  Code,
  ScrollArea,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronUp,
  IconPin,
  IconPinnedOff,
} from '@tabler/icons-react';

// History entry interface
interface HistoryEntry {
  id: string;
  timestamp: string;
  method: string;
  target: string | null;
  params?: Record<string, unknown>;
  response?: Record<string, unknown>;
  duration: number;
  success: boolean;
  pinned: boolean;
  label?: string;
}

// Mock history data with params and response
const initialHistory: HistoryEntry[] = [
  {
    id: 'req-1',
    timestamp: '2025-11-30T14:24:12Z',
    method: 'tools/call',
    target: 'echo',
    params: { message: 'Hello world' },
    response: { content: [{ type: 'text', text: 'Hello world' }] },
    duration: 45,
    success: true,
    pinned: true,
    label: 'Test echo',
  },
  {
    id: 'req-2',
    timestamp: '2025-11-30T14:23:05Z',
    method: 'tools/list',
    target: null,
    params: {},
    response: { tools: ['echo', 'add', 'longOp'] },
    duration: 12,
    success: true,
    pinned: false,
  },
  {
    id: 'req-3',
    timestamp: '2025-11-30T14:22:00Z',
    method: 'resources/read',
    target: 'file:///config.json',
    params: { uri: 'file:///config.json' },
    response: { name: 'my-app', version: '1.0.0' },
    duration: 8,
    success: true,
    pinned: true,
    label: 'Get config',
  },
  {
    id: 'req-4',
    timestamp: '2025-11-30T14:21:30Z',
    method: 'prompts/get',
    target: 'greeting_prompt',
    params: { name: 'greeting_prompt', arguments: { name: 'John' } },
    response: { error: 'Prompt not found' },
    duration: 0,
    success: false,
    pinned: false,
  },
];

interface HistoryCardProps {
  entry: HistoryEntry;
  expanded: boolean;
  onToggleExpand: () => void;
  onTogglePin: () => void;
}

function HistoryCard({ entry, expanded, onToggleExpand, onTogglePin }: HistoryCardProps) {
  return (
    <Card
      withBorder
      style={entry.pinned ? { borderColor: 'var(--mantine-color-yellow-5)', borderWidth: 1 } : undefined}
    >
      <Stack gap="sm" p="md">
        {/* Header row */}
        <Group justify="space-between">
          <Group gap="sm">
            {entry.pinned && <Text c="yellow">*</Text>}
            <Text size="sm" c="dimmed" ff="monospace">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </Text>
            <Badge variant="light" size="sm">
              {entry.method}
            </Badge>
            {entry.target && <Text size="sm" fw={500}>{entry.target}</Text>}
          </Group>
          <Group gap="sm">
            <Badge color={entry.success ? 'green' : 'red'} size="sm">
              {entry.success ? 'OK' : 'Error'}
            </Badge>
            <Text size="sm" c="dimmed">{entry.duration}ms</Text>
          </Group>
        </Group>

        {/* Parameters (always visible if present) */}
        {entry.params && Object.keys(entry.params).length > 0 && (
          <Text size="sm">
            <Text span c="dimmed">Parameters: </Text>
            <Code>{JSON.stringify(entry.params)}</Code>
          </Text>
        )}

        {/* Expandable response section */}
        {expanded && entry.response && (
          <Stack gap="xs" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-dark-4)' }}>
            <Text size="sm" c="dimmed">Response:</Text>
            <Code block style={{ maxHeight: 192, overflow: 'auto' }}>
              {JSON.stringify(entry.response, null, 2)}
            </Code>
          </Stack>
        )}

        {/* Actions row */}
        <Group justify="space-between" pt="xs">
          <Group gap="xs">
            <Button variant="subtle" size="xs">
              Replay
            </Button>
            <Button
              variant="subtle"
              size="xs"
              onClick={onTogglePin}
              leftSection={entry.pinned ? <IconPinnedOff size={14} /> : <IconPin size={14} />}
            >
              {entry.pinned ? 'Unpin' : 'Pin'}
            </Button>
          </Group>
          {entry.response && (
            <Button
              variant="subtle"
              size="xs"
              onClick={onToggleExpand}
              leftSection={expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
            >
              {expanded ? 'Collapse' : 'Expand'}
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  );
}

export function History() {
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const togglePin = (id: string) => {
    setHistory((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, pinned: !entry.pinned } : entry
      )
    );
  };

  const handleClearAll = () => {
    setHistory([]);
  };

  // Filter history
  const filteredHistory = history.filter((entry) => {
    const matchesSearch =
      searchFilter === '' ||
      entry.method.toLowerCase().includes(searchFilter.toLowerCase()) ||
      entry.target?.toLowerCase().includes(searchFilter.toLowerCase()) ||
      JSON.stringify(entry.params).toLowerCase().includes(searchFilter.toLowerCase());
    const matchesMethod = !methodFilter || entry.method === methodFilter;
    return matchesSearch && matchesMethod;
  });

  // Separate pinned and unpinned
  const pinnedEntries = filteredHistory.filter((entry) => entry.pinned);
  const unpinnedEntries = filteredHistory.filter((entry) => !entry.pinned);

  return (
    <ScrollArea h="calc(100vh - 120px)">
      <Stack gap="lg">
        {/* Header */}
        <Card withBorder>
          <Group justify="space-between" p="md">
            <Title order={4}>Request History</Title>
            <Group gap="sm">
              <TextInput
                placeholder="Search..."
                size="sm"
                w={200}
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
              <Select
                size="sm"
                w={160}
                placeholder="Filter by method"
                clearable
                value={methodFilter}
                onChange={setMethodFilter}
                data={[
                  { value: 'tools/call', label: 'tools/call' },
                  { value: 'tools/list', label: 'tools/list' },
                  { value: 'resources/read', label: 'resources/read' },
                  { value: 'prompts/get', label: 'prompts/get' },
                ]}
              />
              <Button variant="outline" size="sm" onClick={handleClearAll}>
                Clear All
              </Button>
            </Group>
          </Group>
        </Card>

        {/* History entries */}
        {unpinnedEntries.length === 0 && pinnedEntries.length === 0 ? (
          <Card withBorder>
            <Text c="dimmed" ta="center" py="xl">
              No history entries
            </Text>
          </Card>
        ) : (
          <Stack gap="sm">
            {unpinnedEntries.map((entry) => (
              <HistoryCard
                key={entry.id}
                entry={entry}
                expanded={expandedIds.has(entry.id)}
                onToggleExpand={() => toggleExpand(entry.id)}
                onTogglePin={() => togglePin(entry.id)}
              />
            ))}
          </Stack>
        )}

        {/* Pinned Requests Section */}
        {pinnedEntries.length > 0 && (
          <Stack gap="sm">
            <Title order={5}>Pinned Requests ({pinnedEntries.length})</Title>
            <Card withBorder>
              <Stack gap={0} p="md">
                {pinnedEntries.map((entry) => (
                  <Group
                    key={entry.id}
                    justify="space-between"
                    py="sm"
                    style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}
                  >
                    <Group gap="sm">
                      <Text c="yellow">*</Text>
                      {entry.label && (
                        <Text size="sm" fw={500}>"{entry.label}"</Text>
                      )}
                      <Badge variant="light" size="xs">
                        {entry.method}
                      </Badge>
                      {entry.target && (
                        <Text size="sm" c="dimmed">{entry.target}</Text>
                      )}
                      <Text size="xs" c="dimmed">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </Text>
                    </Group>
                    <Group gap="xs">
                      <Button variant="subtle" size="xs">
                        Replay
                      </Button>
                      <Button
                        variant="subtle"
                        size="xs"
                        onClick={() => togglePin(entry.id)}
                        leftSection={<IconPinnedOff size={14} />}
                      >
                        Unpin
                      </Button>
                    </Group>
                  </Group>
                ))}
              </Stack>
            </Card>
          </Stack>
        )}

        {/* Footer stats */}
        <Text size="sm" c="dimmed" ta="right">
          Showing {filteredHistory.length} of {history.length} entries
        </Text>
      </Stack>
    </ScrollArea>
  );
}
