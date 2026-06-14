import { useMemo } from "react";
import {
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { LogEntry } from "../../elements/LogEntry/LogEntry";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";
import {
  SortToggle,
  type SortDirection,
} from "../../elements/SortToggle/SortToggle";
import { useScrollMemory } from "../../../hooks/useScrollMemory";

export interface LogStreamPanelProps {
  entries: LogEntryData[];
  filterText: string;
  visibleLevels: Record<LoggingLevel, boolean>;
  onClear: () => void;
  onExport: () => void;
  sortDirection: SortDirection;
  onSortChange: (next: SortDirection) => void;
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
}: LogStreamPanelProps) {
  const viewportRef = useScrollMemory("logs-stream");
  const filteredEntries = useMemo(() => {
    // `.filter()` returns a fresh array, so sorting in-place is safe.
    const sorted = entries
      .filter((e) => matchesFilters(e, filterText, visibleLevels))
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    if (sortDirection === "newest-first") sorted.reverse();
    return sorted;
  }, [entries, filterText, visibleLevels, sortDirection]);

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
        <ScrollArea.Autosize
          viewportRef={viewportRef}
          mah="calc(100vh - var(--app-shell-header-height, 0px) - 150px)"
          type="scroll"
          offsetScrollbars
        >
          <Stack gap="xs">
            {filteredEntries.map((entry, index) => (
              <LogEntry key={index} entry={entry} />
            ))}
          </Stack>
        </ScrollArea.Autosize>
      ) : (
        <EmptyCenter>
          <Text c="dimmed">No log entries</Text>
        </EmptyCenter>
      )}
    </PanelContainer>
  );
}
