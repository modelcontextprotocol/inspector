import { useMemo } from "react";
import {
  Button,
  Checkbox,
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

export interface LogStreamPanelProps {
  entries: LogEntryData[];
  filterText: string;
  visibleLevels: Record<LoggingLevel, boolean>;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  onCopyAll: () => void;
  onClear: () => void;
  onExport: () => void;
}

const PanelContainer = Paper.withProps({
  withBorder: true,
  p: "lg",
  flex: 1,
  variant: "panel",
});

const ToolbarButton = Button.withProps({
  variant: "subtle",
  size: "sm",
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
  autoScroll,
  onToggleAutoScroll,
  onCopyAll,
  onClear,
  onExport,
}: LogStreamPanelProps) {
  const filteredEntries = useMemo(
    () => entries.filter((e) => matchesFilters(e, filterText, visibleLevels)),
    [entries, filterText, visibleLevels],
  );

  return (
    <PanelContainer>
      <Group justify="space-between" mb="sm">
        <Title order={4}>Log Stream</Title>
        <Group>
          <Checkbox
            label="Auto-scroll"
            checked={autoScroll}
            onChange={onToggleAutoScroll}
          />
          <ToolbarButton onClick={onClear}>Clear</ToolbarButton>
          <ToolbarButton onClick={onExport}>Export</ToolbarButton>
          <ToolbarButton onClick={onCopyAll}>Copy All</ToolbarButton>
        </Group>
      </Group>
      {filteredEntries.length > 0 ? (
        <ScrollArea.Autosize mah="calc(100vh - var(--app-shell-header-height, 0px) - 150px)">
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
