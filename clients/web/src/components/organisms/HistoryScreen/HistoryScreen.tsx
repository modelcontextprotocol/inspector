import { Button, Divider, Group, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { HistoryEntry } from '../../molecules/HistoryEntry/HistoryEntry'
import type { HistoryEntryProps } from '../../molecules/HistoryEntry/HistoryEntry'

export interface HistoryScreenProps {
  entries: HistoryEntryProps[]
  pinnedEntries: HistoryEntryProps[]
  searchText: string
  methodFilter?: string
  totalCount: number
  displayedCount: number
  onSearchChange: (text: string) => void
  onMethodFilterChange: (method: string) => void
  onLoadMore: () => void
  onClearAll: () => void
  onExport: () => void
}

const METHOD_OPTIONS = [
  'tools/call',
  'tools/list',
  'resources/read',
  'resources/list',
  'prompts/get',
  'prompts/list',
  'sampling/createMessage',
  'elicitation/create',
]

export function HistoryScreen({
  entries,
  pinnedEntries,
  searchText,
  methodFilter,
  totalCount,
  displayedCount,
  onSearchChange,
  onMethodFilterChange,
  onLoadMore,
  onClearAll,
  onExport,
}: HistoryScreenProps) {
  return (
    <Paper withBorder p="md">
      <Stack gap="md">
        <Group justify="space-between" wrap="wrap">
          <Title order={3}>Request History</Title>
          <Group>
            <TextInput
              placeholder="Search..."
              value={searchText}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
            />
            <Select
              placeholder="Filter by method"
              data={METHOD_OPTIONS}
              value={methodFilter}
              onChange={(value) => onMethodFilterChange(value ?? '')}
              clearable
            />
            <Button variant="light" size="sm" onClick={onExport}>
              Export JSON
            </Button>
            <Button variant="light" size="sm" onClick={onClearAll}>
              Clear All
            </Button>
          </Group>
        </Group>

        {entries.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">
            No request history
          </Text>
        ) : (
          <Stack gap="md">
            {entries.map((entry) => (
              <HistoryEntry key={`${entry.timestamp}-${entry.method}`} {...entry} />
            ))}
          </Stack>
        )}

        {pinnedEntries.length > 0 && (
          <>
            <Divider />
            <Title order={4}>Pinned Requests ({pinnedEntries.length})</Title>
            <Stack gap="sm">
              {pinnedEntries.map((entry) => (
                <HistoryEntry key={`${entry.timestamp}-${entry.method}`} {...entry} />
              ))}
            </Stack>
          </>
        )}

        <Group justify="flex-end">
          <Text size="sm" c="dimmed">
            Showing {displayedCount} of {totalCount} entries
          </Text>
          {displayedCount < totalCount && (
            <Button variant="light" size="sm" onClick={onLoadMore}>
              Load More
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  )
}
