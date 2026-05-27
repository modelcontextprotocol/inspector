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

function headersToString(headers: Record<string, string> | undefined): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function matchesFilters(
  entry: FetchRequestEntry,
  filterText: string,
  visibleCategories: Record<FetchRequestCategory, boolean>,
): boolean {
  if (!visibleCategories[entry.category]) return false;
  if (filterText) {
    const term = filterText.toLowerCase();
    const status =
      entry.responseStatus !== undefined ? String(entry.responseStatus) : "";
    // Per-field match (rather than join + includes) so the search term
    // can't span field boundaries — a search for "foo bar" where one
    // field ends "foo" and the next begins "bar" should not match.
    const fields: string[] = [
      entry.method,
      entry.url,
      status,
      entry.responseStatusText ?? "",
      headersToString(entry.requestHeaders),
      headersToString(entry.responseHeaders),
      entry.requestBody ?? "",
      entry.responseBody ?? "",
      entry.error ?? "",
    ];
    if (!fields.some((f) => f.toLowerCase().includes(term))) return false;
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
