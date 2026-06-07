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
import type {
  FetchRequestCategory,
  FetchRequestEntry,
  MessageOrigin,
} from "@inspector/core/mcp/types.js";
import { NetworkEntry } from "../NetworkEntry/NetworkEntry";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import {
  SortToggle,
  type SortDirection,
} from "../../elements/SortToggle/SortToggle";
import { useScrollMemory } from "../../../hooks/useScrollMemory";

// Every network fetch is inspector-originated (the inspector is the HTTP
// client), so they're all "client" / client → server for the direction filter.
const NETWORK_ENTRY_ORIGIN: MessageOrigin = "client";

export interface NetworkStreamPanelProps {
  entries: FetchRequestEntry[];
  filterText: string;
  visibleCategories: Record<FetchRequestCategory, boolean>;
  visibleDirections: Record<MessageOrigin, boolean>;
  onClear: () => void;
  onExport: () => void;
  sortDirection: SortDirection;
  onSortChange: (next: SortDirection) => void;
  compact: boolean;
  onToggleCompact: () => void;
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
  visibleDirections: Record<MessageOrigin, boolean>,
): boolean {
  if (!visibleCategories[entry.category]) return false;
  // All fetches are outgoing (client → server), so the client toggle gates them
  // all; the server toggle never matches.
  if (!visibleDirections[NETWORK_ENTRY_ORIGIN]) return false;
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
  visibleDirections,
  onClear,
  onExport,
  sortDirection,
  onSortChange,
  compact,
  onToggleCompact,
}: NetworkStreamPanelProps) {
  const viewportRef = useScrollMemory("network-stream");
  const filteredEntries = useMemo(() => {
    // `.filter()` returns a fresh array, so sorting in-place is safe.
    const sorted = entries
      .filter((e) =>
        matchesFilters(e, filterText, visibleCategories, visibleDirections),
      )
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    if (sortDirection === "newest-first") sorted.reverse();
    return sorted;
  }, [
    entries,
    filterText,
    visibleCategories,
    visibleDirections,
    sortDirection,
  ]);

  const hasEntries = entries.length > 0;
  const hasResults = filteredEntries.length > 0;

  return (
    <PanelContainer>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{formatTitle(filteredEntries.length)}</Title>
        <Group gap="xs">
          {hasResults && (
            <ListToggle compact={compact} onToggle={onToggleCompact} />
          )}
          <SortToggle
            value={sortDirection}
            onChange={onSortChange}
            aria-label="Network sort direction"
          />
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
        <ScrollArea.Autosize
          viewportRef={viewportRef}
          mah="calc(100vh - var(--app-shell-header-height, 0px) - 150px)"
        >
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
