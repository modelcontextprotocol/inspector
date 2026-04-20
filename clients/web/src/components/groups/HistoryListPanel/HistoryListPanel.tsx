import { useMemo, useState } from "react";
import {
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { MessageEntry } from "../../../../../../core/mcp/types.js";
import { HistoryEntry } from "../HistoryEntry/HistoryEntry";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import { extractMethod } from "../historyUtils.js";

export interface HistoryListPanelProps {
  entries: MessageEntry[];
  pinnedIds: Set<string>;
  searchText: string;
  methodFilter?: string;
  onClearAll: () => void;
  onExport: () => void;
  onReplay: (id: string) => void;
  onTogglePin: (id: string) => void;
}

const ToolbarButton = Button.withProps({
  variant: "subtle",
  size: "sm",
});

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

function formatPinnedTitle(count: number): string {
  return `Pinned Requests (${count})`;
}

function formatHistoryTitle(count: number): string {
  return `History (${count})`;
}

function matchesFilters(
  entry: MessageEntry,
  searchText: string,
  methodFilter?: string,
): boolean {
  const method = extractMethod(entry);
  if (methodFilter && method !== methodFilter) return false;
  if (searchText) {
    const term = searchText.toLowerCase();
    const responseText = entry.response ? JSON.stringify(entry.response) : "";
    const searchable =
      `${method} ${entry.id} ${JSON.stringify(entry.message)} ${responseText}`.toLowerCase();
    if (!searchable.includes(term)) return false;
  }
  return true;
}

export function HistoryListPanel({
  entries,
  pinnedIds,
  searchText,
  methodFilter,
  onClearAll,
  onExport,
  onReplay,
  onTogglePin,
}: HistoryListPanelProps) {
  const [compact, setCompact] = useState(false);

  const filteredEntries = useMemo(
    () => entries.filter((e) => matchesFilters(e, searchText, methodFilter)),
    [entries, searchText, methodFilter],
  );

  const pinnedEntries = useMemo(
    () => filteredEntries.filter((e) => pinnedIds.has(e.id)),
    [filteredEntries, pinnedIds],
  );

  const unpinnedEntries = useMemo(
    () => filteredEntries.filter((e) => !pinnedIds.has(e.id)),
    [filteredEntries, pinnedIds],
  );

  const hasResults = filteredEntries.length > 0;

  return (
    <PanelContainer>
      <Group justify="space-between" mb="sm">
        <Title order={4}>Requests</Title>
        <Group gap="xs">
          <ToolbarButton onClick={onExport}>Export JSON</ToolbarButton>
          {hasResults && (
            <ListToggle
              compact={compact}
              onToggle={() => setCompact((c) => !c)}
            />
          )}
        </Group>
      </Group>

      {!hasResults ? (
        <EmptyState>No request history</EmptyState>
      ) : (
        <ScrollArea.Autosize mah="calc(100vh - var(--app-shell-header-height, 0px) - 150px)">
          <Stack gap="md">
            {pinnedEntries.length > 0 && (
              <>
                <Title order={5}>
                  {formatPinnedTitle(pinnedEntries.length)}
                </Title>
                {pinnedEntries.map((entry) => (
                  <HistoryEntry
                    key={entry.id}
                    entry={entry}
                    isPinned={true}
                    isListExpanded={!compact}
                    onReplay={() => onReplay(entry.id)}
                    onTogglePin={() => onTogglePin(entry.id)}
                  />
                ))}
              </>
            )}

            {unpinnedEntries.length > 0 && (
              <>
                <Group justify="space-between">
                  <Title order={5}>
                    {formatHistoryTitle(unpinnedEntries.length)}
                  </Title>
                  <ToolbarButton onClick={onClearAll}>Clear</ToolbarButton>
                </Group>
                {unpinnedEntries.map((entry) => (
                  <HistoryEntry
                    key={entry.id}
                    entry={entry}
                    isPinned={false}
                    isListExpanded={!compact}
                    onReplay={() => onReplay(entry.id)}
                    onTogglePin={() => onTogglePin(entry.id)}
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
