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
  Collapse,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronUp,
  IconPin,
  IconPinnedOff,
  IconDownload,
} from '@tabler/icons-react';
import { initialHistory, type HistoryEntry } from '@/mocks';

// Pagination page size
const PAGE_SIZE = 10;

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

        {/* Metadata row: SSE ID, Progress Token */}
        {(entry.sseId || entry.progressToken) && (
          <Group gap="lg">
            {entry.sseId && (
              <Text size="xs" c="dimmed">
                SSE ID: <Code>{entry.sseId}</Code>
              </Text>
            )}
            {entry.progressToken && (
              <Text size="xs" c="dimmed">
                Progress Token: <Code>{entry.progressToken}</Code>
              </Text>
            )}
          </Group>
        )}

        {/* Expandable response section with Collapse */}
        <Collapse in={expanded}>
          {entry.response && (
            <Stack gap="xs" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-dark-4)' }}>
              <Text size="sm" c="dimmed">Response:</Text>
              <Code block style={{ maxHeight: 192, overflow: 'auto' }}>
                {JSON.stringify(entry.response, null, 2)}
              </Code>
            </Stack>
          )}
        </Collapse>

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
    setHistory([]);
  };

  // Export history as JSON
  const handleExport = () => {
    const dataStr = JSON.stringify(filteredHistory, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const link = document.createElement('a');
    link.setAttribute('href', dataUri);
    link.setAttribute('download', `mcp-history-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Load more entries
  const handleLoadMore = () => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  };

  // Filter history
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

  // Paginate unpinned entries
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

        {/* History entries */}
        {unpinnedEntries.length === 0 && pinnedEntries.length === 0 ? (
          <Card withBorder>
            <Text c="dimmed" ta="center" py="xl">
              No history entries
            </Text>
          </Card>
        ) : (
          <Stack gap="sm">
            {visibleUnpinnedEntries.map((entry) => (
              <HistoryCard
                key={entry.id}
                entry={entry}
                expanded={expandedIds.has(entry.id)}
                onToggleExpand={() => toggleExpand(entry.id)}
                onTogglePin={() => togglePin(entry.id)}
              />
            ))}
            {/* Load More button */}
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
