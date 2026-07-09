import { useMemo } from "react";
import {
  Button,
  Card,
  Flex,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type { StderrLogEntry } from "@inspector/core/mcp/types.js";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import {
  SortToggle,
  type SortDirection,
} from "../../elements/SortToggle/SortToggle";
import { PinColumnButton } from "../../elements/PinColumnButton/PinColumnButton";
import { EmbeddableScrollArea } from "../../elements/EmbeddableScrollArea/EmbeddableScrollArea";
import { useScrollMemory } from "../../../hooks/useScrollMemory";

export interface ConsoleScreenProps {
  entries: StderrLogEntry[];
  ui: ConsoleUiState;
  onUiChange: (next: ConsoleUiState) => void;
  onClear: () => void;
  onExport: () => void;
  sortDirection: SortDirection;
  onSortChange: (next: SortDirection) => void;
  /** See LoggingScreen: shows a "pin as column" button when set (#1616). */
  onPin?: () => void;
  /** See LoggingScreen: fills the parent height and drops the filter sidebar. */
  embedded?: boolean;
}

// Just the search text — stderr has no levels/categories to filter, so this is
// the whole of the Console screen's lifted UI state. Controlled by the parent
// (App) so it survives tab navigation within a live session (#1417).
export interface ConsoleUiState {
  filterText: string;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100dvh - var(--app-shell-header-height, 0px))",
  gap: "md",
  p: "xl",
});

const Sidebar = Stack.withProps({
  w: 340,
  flex: "0 0 auto",
});

const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

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

// A single stderr line: a dimmed monospace timestamp beside the process's raw
// output. `align: flex-start` keeps the timestamp on the first wrapped row.
const EntryRow = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
  align: "flex-start",
});

const TimestampText = Text.withProps({
  size: "sm",
  ff: "monospace",
  c: "dimmed",
  flex: "0 0 auto",
});

// `consoleLine` (theme variant) preserves the process's own newlines/whitespace
// while wrapping over-long lines inside the narrow column.
const MessageText = Text.withProps({
  size: "sm",
  ff: "monospace",
  variant: "consoleLine",
  flex: 1,
});

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString();
}

function matchesFilter(entry: StderrLogEntry, filterText: string): boolean {
  if (!filterText) return true;
  return entry.message.toLowerCase().includes(filterText.toLowerCase());
}

export function ConsoleScreen({
  entries,
  ui,
  onUiChange,
  onClear,
  onExport,
  sortDirection,
  onSortChange,
  onPin,
  embedded = false,
}: ConsoleScreenProps) {
  const { filterText } = ui;
  const viewportRef = useScrollMemory("console-stream");

  const filteredEntries = useMemo(() => {
    // `.filter()` returns a fresh array, so sorting in-place is safe.
    const sorted = entries
      .filter((e) => matchesFilter(e, filterText))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    if (sortDirection === "newest-first") sorted.reverse();
    return sorted;
  }, [entries, filterText, sortDirection]);

  return (
    <ScreenLayout h={embedded ? "100%" : undefined}>
      {embedded ? null : (
        <Sidebar>
          <SidebarCard>
            <Stack gap="md">
              <Title order={4}>Console</Title>
              <TextInput
                placeholder="Search..."
                value={filterText}
                onChange={(e) =>
                  onUiChange({ filterText: e.currentTarget.value })
                }
                rightSectionPointerEvents="auto"
                rightSection={
                  filterText ? (
                    <ClearButton
                      onClick={() => onUiChange({ filterText: "" })}
                    />
                  ) : null
                }
              />
            </Stack>
          </SidebarCard>
        </Sidebar>
      )}
      <PanelContainer>
        <Group justify="space-between" mb="sm">
          <Title order={4}>Server Console</Title>
          <Group>
            <SortToggle
              value={sortDirection}
              onChange={onSortChange}
              aria-label="Console sort direction"
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
                <EntryRow key={index}>
                  <TimestampText>
                    {formatTimestamp(entry.timestamp)}
                  </TimestampText>
                  <MessageText>{entry.message}</MessageText>
                </EntryRow>
              ))}
            </Stack>
          </EmbeddableScrollArea>
        ) : (
          <EmptyCenter>
            <Text c="dimmed">No console output</Text>
          </EmptyCenter>
        )}
      </PanelContainer>
    </ScreenLayout>
  );
}
