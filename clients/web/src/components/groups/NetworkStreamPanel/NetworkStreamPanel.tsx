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
import type {
  FetchRequestCategory,
  FetchRequestEntry,
} from "@inspector/core/mcp/types.js";
import { NetworkEntry } from "../NetworkEntry/NetworkEntry";
import { ListToggle } from "../../elements/ListToggle/ListToggle";

export interface NetworkStreamPanelProps {
  entries: FetchRequestEntry[];
  filterText: string;
  visibleCategories: Record<FetchRequestCategory, boolean>;
  onClear: () => void;
  onExport: () => void;
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

function formatTitle(count: number): string {
  return `Requests (${count})`;
}

function matchesFilters(
  entry: FetchRequestEntry,
  filterText: string,
  visibleCategories: Record<FetchRequestCategory, boolean>,
): boolean {
  if (!visibleCategories[entry.category]) return false;
  if (filterText) {
    const term = filterText.toLowerCase();
    const requestHeadersText = Object.entries(entry.requestHeaders)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    const responseHeadersText = entry.responseHeaders
      ? Object.entries(entry.responseHeaders)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      : "";
    const status =
      entry.responseStatus !== undefined ? String(entry.responseStatus) : "";
    const searchable =
      `${entry.method} ${entry.url} ${status} ${requestHeadersText} ${responseHeadersText} ${entry.error ?? ""}`.toLowerCase();
    if (!searchable.includes(term)) return false;
  }
  return true;
}

export function NetworkStreamPanel({
  entries,
  filterText,
  visibleCategories,
  onClear,
  onExport,
}: NetworkStreamPanelProps) {
  const [compact, setCompact] = useState(true);

  const filteredEntries = useMemo(
    () =>
      entries.filter((e) => matchesFilters(e, filterText, visibleCategories)),
    [entries, filterText, visibleCategories],
  );

  const hasEntries = entries.length > 0;
  const hasResults = filteredEntries.length > 0;

  return (
    <PanelContainer>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{formatTitle(filteredEntries.length)}</Title>
        <Group gap="xs">
          {hasResults && (
            <ListToggle
              compact={compact}
              onToggle={() => setCompact((c) => !c)}
            />
          )}
          <Button variant="default" onClick={onClear} disabled={!hasEntries}>
            Clear
          </Button>
          <Button variant="default" onClick={onExport} disabled={!hasEntries}>
            Export
          </Button>
        </Group>
      </Group>

      {!hasResults ? (
        <EmptyState>No network requests</EmptyState>
      ) : (
        <ScrollArea.Autosize mah="calc(100vh - var(--app-shell-header-height, 0px) - 150px)">
          <Stack gap="md">
            {filteredEntries.map((entry) => (
              <NetworkEntry
                key={entry.id}
                entry={entry}
                isListExpanded={!compact}
              />
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </PanelContainer>
  );
}
