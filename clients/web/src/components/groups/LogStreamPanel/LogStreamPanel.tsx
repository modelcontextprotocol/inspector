import { useMemo } from "react";
import { Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { LogEntry } from "../../elements/LogEntry/LogEntry";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";
import {
  SortToggle,
  type SortDirection,
} from "../../elements/SortToggle/SortToggle";
import { PinColumnButton } from "../../elements/PinColumnButton/PinColumnButton";
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
   * When set, renders a "pin as column" button in the toolbar that opens this
   * screen in the monitoring column (#1616). Omitted when the panel is already
   * embedded in that column (or when pinning isn't available).
   */
  onPin?: () => void;
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
): boolean {
  if (!visibleLevels[entry.params.level]) return false;
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
  onPin,
  embedded = false,
}: LogStreamPanelProps) {
  const viewportRef = useScrollMemory("logs-stream");
  const filteredEntries = useMemo(() => {
    // The embedded column has no filter sidebar, so it shows the full stream
    // rather than mirroring the full-size screen's live filter with no visible
    // control to explain it (#1616). `.filter()` returns a fresh array, so
    // sorting in-place is safe.
    const sorted = entries
      .filter((e) => embedded || matchesFilters(e, filterText, visibleLevels))
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
          {onPin ? <PinColumnButton onPin={onPin} /> : null}
        </Group>
      </Group>
      {filteredEntries.length > 0 ? (
        <EmbeddableScrollArea embedded={embedded} viewportRef={viewportRef}>
          <Stack gap="xs">
            {filteredEntries.map((entry, index) => (
              <LogEntry key={index} entry={entry} />
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
