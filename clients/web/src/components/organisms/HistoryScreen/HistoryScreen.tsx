import {
  Button,
  Container,
  Divider,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { HistoryEntry } from "../../molecules/HistoryEntry/HistoryEntry";
import type { HistoryEntryProps } from "../../molecules/HistoryEntry/HistoryEntry";

export interface HistoryScreenProps {
  entries: HistoryEntryProps[];
  pinnedEntries: HistoryEntryProps[];
  searchText: string;
  methodFilter?: string;
  totalCount: number;
  displayedCount: number;
  onSearchChange: (text: string) => void;
  onMethodFilterChange: (method: string) => void;
  onLoadMore: () => void;
  onClearAll: () => void;
  onExport: () => void;
}

const METHOD_OPTIONS = [
  "tools/call",
  "tools/list",
  "resources/read",
  "resources/list",
  "prompts/get",
  "prompts/list",
  "sampling/createMessage",
  "elicitation/create",
];

const PageContainer = Container.withProps({
  size: "xl",
  py: "xl",
});

const ContentPanel = Paper.withProps({
  withBorder: true,
  p: "md",
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "wrap",
});

const ToolbarButton = Button.withProps({
  variant: "light",
  size: "sm",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

const CountText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

function entryKey(entry: HistoryEntryProps): string {
  return `${entry.timestamp}-${entry.method}`;
}

function formatPinnedTitle(count: number): string {
  return `Pinned Requests (${count})`;
}

function formatPagination(displayed: number, total: number): string {
  return `Showing ${displayed} of ${total} entries`;
}

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
    <PageContainer>
      <ContentPanel>
        <Stack gap="md">
          <HeaderRow>
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
                onChange={(value) => onMethodFilterChange(value ?? "")}
                clearable
              />
              <ToolbarButton onClick={onExport}>Export JSON</ToolbarButton>
              <ToolbarButton onClick={onClearAll}>Clear All</ToolbarButton>
            </Group>
          </HeaderRow>

          {entries.length === 0 ? (
            <EmptyState>No request history</EmptyState>
          ) : (
            <Stack gap="md">
              {entries.map((entry) => (
                <HistoryEntry key={entryKey(entry)} {...entry} />
              ))}
            </Stack>
          )}

          {pinnedEntries.length > 0 && (
            <>
              <Divider />
              <Title order={4}>{formatPinnedTitle(pinnedEntries.length)}</Title>
              <Stack gap="sm">
                {pinnedEntries.map((entry) => (
                  <HistoryEntry key={entryKey(entry)} {...entry} />
                ))}
              </Stack>
            </>
          )}

          <Group justify="flex-end">
            <CountText>
              {formatPagination(displayedCount, totalCount)}
            </CountText>
            {displayedCount < totalCount && (
              <ToolbarButton onClick={onLoadMore}>Load More</ToolbarButton>
            )}
          </Group>
        </Stack>
      </ContentPanel>
    </PageContainer>
  );
}
