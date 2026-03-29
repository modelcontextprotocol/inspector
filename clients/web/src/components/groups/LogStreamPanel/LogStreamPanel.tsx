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
import { LogEntry } from "../../elements/LogEntry/LogEntry";
import type { LogEntryProps } from "../../elements/LogEntry/LogEntry";

export interface LogStreamPanelProps {
  entries: LogEntryProps[];
  filterText: string;
  visibleLevels: Record<string, boolean>;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  onCopyAll: () => void;
}

const PanelContainer = Paper.withProps({
  withBorder: true,
  p: "lg",
  flex: 1,
  variant: "panel",
});

const ToolbarButton = Button.withProps({
  variant: "light",
  size: "sm",
});

const EmptyCenter = Stack.withProps({
  flex: 1,
  align: "center",
  justify: "center",
});

function matchesFilters(
  entry: LogEntryProps,
  filterText: string,
  visibleLevels: Record<string, boolean>,
): boolean {
  if (!visibleLevels[entry.level]) return false;
  if (filterText) {
    const term = filterText.toLowerCase();
    const searchable =
      `${entry.message} ${entry.logger ?? ""} ${entry.level}`.toLowerCase();
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
          <ToolbarButton onClick={onCopyAll}>Copy All</ToolbarButton>
        </Group>
      </Group>
      {filteredEntries.length > 0 ? (
        <ScrollArea.Autosize mah="calc(100vh - var(--app-shell-header-height, 0px) - 150px)">
          <Stack gap="xs">
            {filteredEntries.map((entry, index) => (
              <LogEntry key={index} {...entry} />
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
