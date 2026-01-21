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
  ScrollArea,
  Collapse,
  Code,
} from '@mantine/core';
import {
  IconPinned,
  IconPinnedOff,
  IconDownload,
  IconChevronDown,
  IconChevronRight,
} from '@tabler/icons-react';
import type { HistoryEntry } from '@modelcontextprotocol/inspector-core';
import { initialHistory } from '@/mocks';

// NOTE: Using local state with mock data instead of storage context.
// Storage solution pending per issue #983.
// Tree view (HistoryTreeNode) will be added in PR #3.

const PAGE_SIZE = 10;

export function History() {
  // Local state for history (instead of storage context)
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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
    if (confirm('Clear all non-pinned history entries?')) {
      setHistory((prev) => prev.filter((entry) => entry.pinned));
    }
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(history, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const link = document.createElement('a');
    link.setAttribute('href', dataUri);
    link.setAttribute('download', `mcp-history-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleLoadMore = () => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  };

  // Filter entries
  const filteredHistory = history.filter((entry) => {
    const matchesSearch =
      searchFilter === '' ||
      entry.method.toLowerCase().includes(searchFilter.toLowerCase()) ||
      entry.target?.toLowerCase().includes(searchFilter.toLowerCase()) ||
      JSON.stringify(entry.params).toLowerCase().includes(searchFilter.toLowerCase());
    const matchesMethod = !methodFilter || methodFilter === 'all' || entry.method === methodFilter;
    return matchesSearch && matchesMethod;
  });

  // Separate pinned and unpinned
  const pinnedEntries = filteredHistory.filter((entry) => entry.pinned);
  const unpinnedEntries = filteredHistory.filter((entry) => !entry.pinned);
  const visibleUnpinnedEntries = unpinnedEntries.slice(0, visibleCount);
  const hasMoreEntries = unpinnedEntries.length > visibleCount;

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
                  { value: 'all', label: 'All methods' },
                  { value: 'tools/call', label: 'tools/call' },
                  { value: 'tools/list', label: 'tools/list' },
                  { value: 'resources/read', label: 'resources/read' },
                  { value: 'prompts/get', label: 'prompts/get' },
                ]}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                leftSection={<IconDownload size={14} />}
              >
                Export JSON
              </Button>
              <Button variant="outline" size="sm" onClick={handleClearAll}>
                Clear All
              </Button>
            </Group>
          </Group>
        </Card>

        {/* History entries - flat list (tree view in PR #3) */}
        {filteredHistory.length === 0 ? (
          <Card withBorder>
            <Text c="dimmed" ta="center" py="xl">
              No history entries
            </Text>
          </Card>
        ) : (
          <Stack gap="sm">
            {visibleUnpinnedEntries.map((entry) => (
              <Card key={entry.id} withBorder p="sm">
                <Group justify="space-between">
                  <Group gap="sm">
                    <Button
                      variant="subtle"
                      size="xs"
                      p={0}
                      onClick={() => toggleExpand(entry.id)}
                    >
                      {expandedIds.has(entry.id) ? (
                        <IconChevronDown size={16} />
                      ) : (
                        <IconChevronRight size={16} />
                      )}
                    </Button>
                    <Text size="xs" c="dimmed">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </Text>
                    <Badge variant="light" size="sm">
                      {entry.method}
                    </Badge>
                    {entry.target && (
                      <Text size="sm" fw={500}>{entry.target}</Text>
                    )}
                    <Badge
                      color={entry.success ? 'green' : 'red'}
                      variant="light"
                      size="xs"
                    >
                      {entry.success ? 'success' : 'error'}
                    </Badge>
                    <Text size="xs" c="dimmed">{entry.duration}ms</Text>
                    {entry.sseId && (
                      <Badge variant="outline" size="xs">SSE: {entry.sseId}</Badge>
                    )}
                  </Group>
                  <Group gap="xs">
                    <Button variant="subtle" size="xs">
                      Replay
                    </Button>
                    <Button
                      variant="subtle"
                      size="xs"
                      onClick={() => togglePin(entry.id)}
                      leftSection={entry.pinned ? <IconPinnedOff size={14} /> : <IconPinned size={14} />}
                    >
                      {entry.pinned ? 'Unpin' : 'Pin'}
                    </Button>
                  </Group>
                </Group>

                <Collapse in={expandedIds.has(entry.id)}>
                  <Stack gap="xs" mt="sm">
                    <Text size="xs" fw={500}>Request:</Text>
                    <Code block>{JSON.stringify(entry.params, null, 2)}</Code>
                    <Text size="xs" fw={500}>Response:</Text>
                    <Code block>{JSON.stringify(entry.response, null, 2)}</Code>
                  </Stack>
                </Collapse>
              </Card>
            ))}

            {hasMoreEntries && (
              <Group justify="center" pt="sm">
                <Button variant="outline" onClick={handleLoadMore}>
                  Load More ({unpinnedEntries.length - visibleCount} remaining)
                </Button>
              </Group>
            )}
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
          Showing {visibleUnpinnedEntries.length + pinnedEntries.length} of {filteredHistory.length} entries
          {filteredHistory.length !== history.length && ` (${history.length} total)`}
        </Text>
      </Stack>
    </ScrollArea>
  );
}
