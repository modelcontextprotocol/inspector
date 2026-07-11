import { useMemo } from "react";
import { Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { LogEntry } from "../../elements/LogEntry/LogEntry";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";
import {
  SortToggle,
  type SortDirection,
} from "../../elements/SortToggle/SortToggle";
import { EmbeddableScrollArea } from "../../elements/EmbeddableScrollArea/EmbeddableScrollArea";
import { useScrollMemory } from "../../../hooks/useScrollMemory";

export interface LogStreamPanelProps {
  entries: LogEntryData[];
  filterText: string;
  visibleLevels: Record<LoggingLevel, boolean>;
  onClear: () => void;
  onExport: () => void;
  sortDirection: SortDirection;
  onSortChange: (next: SortDirection) => void;
  /**
   * True when this panel is rendered inside the monitoring column. Switches the
   * scroll region from the viewport-height calc to filling its flex parent, so
   * it fits below the column's controls row without viewport math.
   */
  embedded?: boolean;
}

const PanelContainer = Paper.withProps({
  withBorder: true,
  p: "lg",
  flex: 1,
  variant: "panel",
});

const EmptyCenter = Stack.withProps({
  flex: 1,
  align: "center",
  justify: "center",
});

function formatData(data: unknown): string {
  if (data === undefined || data === null) return "";
  if (typeof data === "string") return data;
  return JSON.stringify(data);
}

function matchesFilters(
  entry: LogEntryData,
  filterText: string,
  visibleLevels: Record<LoggingLevel, boolean>,
  // The embedded column exposes only the search box (no level toggles), so it
  // applies the text filter but skips the level filter (#1616).
  ignoreLevels: boolean,
): boolean {
  if (!ignoreLevels && !visibleLevels[entry.params.level]) return false;
  if (filterText) {
    const term = filterText.toLowerCase();
    const searchable =
      `${formatData(entry.params.data)} ${entry.params.logger ?? ""} ${entry.params.level}`.toLowerCase();
    if (!searchable.includes(term)) return false;
  }
  return true;
}

export function LogStreamPanel({
  entries,
  filterText,
  visibleLevels,
  onClear,
  onExport,
  sortDirection,
  onSortChange,
  embedded = false,
}: LogStreamPanelProps) {
  const viewportRef = useScrollMemory("logs-stream");
  const filteredEntries = useMemo(() => {
    // The embedded column has only the search box (its level toggles live in the
    // full-size sidebar), so it filters by text but ignores the level filter
    // (#1616). `.filter()` returns a fresh array, so sorting in-place is safe.
    const sorted = entries
      .filter((e) => matchesFilters(e, filterText, visibleLevels, embedded))
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    if (sortDirection === "newest-first") sorted.reverse();
    return sorted;
  }, [entries, filterText, visibleLevels, sortDirection, embedded]);

  return (
    <PanelContainer>
      <Group justify="space-between" mb="sm">
        <Title order={4}>Log Stream</Title>
        <Group>
          <SortToggle
            value={sortDirection}
            onChange={onSortChange}
            aria-label="Logs sort direction"
          />
          <Button
            variant="default"
            onClick={onClear}
            disabled={entries.length === 0}
          >
            Clear
          </Button>
          <Button
            variant="default"
            onClick={onExport}
            disabled={entries.length === 0}
          >
            Export
          </Button>
        </Group>
      </Group>
      {filteredEntries.length > 0 ? (
        <EmbeddableScrollArea embedded={embedded} viewportRef={viewportRef}>
          <Stack gap="xs">
            {filteredEntries.map((entry, index) => (
              // Compact (two-line) layout inside the narrow monitoring column;
              // the full single-line row on the standalone Logs screen. (#1661)
              <LogEntry key={index} entry={entry} compact={embedded} />
            ))}
          </Stack>
        </EmbeddableScrollArea>
      ) : (
        <EmptyCenter>
          <Text c="dimmed">No log entries</Text>
        </EmptyCenter>
      )}
    </PanelContainer>
  );
}
