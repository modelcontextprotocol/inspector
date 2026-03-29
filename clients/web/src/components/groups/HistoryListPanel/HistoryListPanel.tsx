import { useMemo, useState } from "react";
import { Group, Paper, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { HistoryEntry } from "../HistoryEntry/HistoryEntry";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import type { HistoryEntryProps } from "../HistoryEntry/HistoryEntry";

export interface HistoryRequestsPanelProps {
  entries: HistoryEntryProps[];
  pinnedEntries: HistoryEntryProps[];
  searchText: string;
  methodFilter?: string;
}

const PanelContainer = Paper.withProps({
  withBorder: true,
  p: "lg",
  flex: 1,
  variant: "panel",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

function entryKey(entry: HistoryEntryProps): string {
  return `${entry.timestamp}-${entry.method}`;
}

function formatPinnedTitle(count: number): string {
  return `Pinned Requests (${count})`;
}

function formatHistoryTitle(count: number): string {
  return `History (${count})`;
}

function matchesFilters(
  entry: HistoryEntryProps,
  searchText: string,
  methodFilter?: string,
): boolean {
  if (methodFilter && entry.method !== methodFilter) return false;
  if (searchText) {
    const term = searchText.toLowerCase();
    const searchable =
      `${entry.method} ${entry.target ?? ""} ${entry.timestamp}`.toLowerCase();
    if (!searchable.includes(term)) return false;
  }
  return true;
}

export function HistoryListPanel({
  entries,
  pinnedEntries,
  searchText,
  methodFilter,
}: HistoryRequestsPanelProps) {
  const [compact, setCompact] = useState(false);

  const filteredEntries = useMemo(
    () => entries.filter((e) => matchesFilters(e, searchText, methodFilter)),
    [entries, searchText, methodFilter],
  );

  const filteredPinned = useMemo(
    () =>
      pinnedEntries.filter((e) => matchesFilters(e, searchText, methodFilter)),
    [pinnedEntries, searchText, methodFilter],
  );

  const hasResults = filteredEntries.length > 0 || filteredPinned.length > 0;

  return (
    <PanelContainer>
      <Group justify="space-between" mb="sm">
        <Title order={4}>Requests</Title>
        {hasResults && (
          <ListToggle
            compact={compact}
            onToggle={() => setCompact((c) => !c)}
          />
        )}
      </Group>

      {!hasResults ? (
        <EmptyState>No request history</EmptyState>
      ) : (
        <ScrollArea.Autosize mah="calc(100vh - var(--app-shell-header-height, 0px) - 150px)">
          <Stack gap="md">
            {filteredPinned.length > 0 && (
              <>
                <Title order={5}>
                  {formatPinnedTitle(filteredPinned.length)}
                </Title>
                {filteredPinned.map((entry) => (
                  <HistoryEntry
                    key={entryKey(entry)}
                    {...entry}
                    isListExpanded={!compact}
                  />
                ))}
              </>
            )}

            {filteredEntries.length > 0 && (
              <>
                <Title order={5}>
                  {formatHistoryTitle(filteredEntries.length)}
                </Title>
                {filteredEntries.map((entry) => (
                  <HistoryEntry
                    key={entryKey(entry)}
                    {...entry}
                    isListExpanded={!compact}
                  />
                ))}
              </>
            )}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </PanelContainer>
  );
}
