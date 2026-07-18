import { useMemo } from "react";
import { Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import type {
  FetchRequestCategory,
  FetchRequestEntry,
} from "@inspector/core/mcp/types.js";
import { NetworkEntry } from "../NetworkEntry/NetworkEntry";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import {
  SortToggle,
  type SortDirection,
} from "../../elements/SortToggle/SortToggle";
import { EmbeddableScrollArea } from "../../elements/EmbeddableScrollArea/EmbeddableScrollArea";
import { useScrollMemory } from "../../../hooks/useScrollMemory";

export interface NetworkStreamPanelProps {
  entries: FetchRequestEntry[];
  filterText: string;
  visibleCategories: Record<FetchRequestCategory, boolean>;
  onClear: () => void;
  onExport: () => void;
  sortDirection: SortDirection;
  onSortChange: (next: SortDirection) => void;
  compact: boolean;
  onToggleCompact: () => void;
  /** See LogStreamPanel: fills the flex parent instead of the viewport calc. */
  embedded?: boolean;
  /** Fetch-entry id targeted by a "reveal in Network" jump — that entry scrolls
   * into view and force-expands, then clears the signal via onRevealComplete. */
  revealId?: string;
  onRevealComplete?: () => void;
}

const PanelContainer = Paper.withProps({
  withBorder: true,
  p: "lg",
  flex: 1,
  variant: "panel",
});

// Centered in the full-height panel so the empty message sits mid-panel rather
// than clinging to the top of an otherwise-empty box (matches LogStreamPanel).
const EmptyCenter = Stack.withProps({
  flex: 1,
  align: "center",
  justify: "center",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
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
  // The embedded column exposes only the search box (no category toggles), so it
  // applies the text filter but skips the category filter (#1616).
  ignoreCategories: boolean,
): boolean {
  if (!ignoreCategories && !visibleCategories[entry.category]) return false;
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
  sortDirection,
  onSortChange,
  compact,
  onToggleCompact,
  embedded = false,
  revealId,
  onRevealComplete,
}: NetworkStreamPanelProps) {
  const viewportRef = useScrollMemory("network-stream");
  const filteredEntries = useMemo(() => {
    // Embedded column filters by text only (its category toggles live in the
    // full-size sidebar). See LogStreamPanel (#1616). `.filter()` returns a
    // fresh array, so sorting in-place is safe.
    const sorted = entries
      .filter((e) => matchesFilters(e, filterText, visibleCategories, embedded))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    if (sortDirection === "newest-first") sorted.reverse();
    return sorted;
  }, [entries, filterText, visibleCategories, sortDirection, embedded]);

  const hasEntries = entries.length > 0;
  const hasResults = filteredEntries.length > 0;

  return (
    <PanelContainer>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{formatTitle(filteredEntries.length)}</Title>
        <Group gap="xs">
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
          {hasResults && (
            <ListToggle compact={compact} onToggle={onToggleCompact} />
          )}
        </Group>
      </Group>

      {!hasResults ? (
        <EmptyCenter>
          <EmptyState>No network requests</EmptyState>
        </EmptyCenter>
      ) : (
        <EmbeddableScrollArea
          embedded={embedded}
          viewportRef={viewportRef}
          constrainContentWidth
        >
          <Stack gap="md">
            {filteredEntries.map((entry) => (
              <NetworkEntry
                key={entry.id}
                entry={entry}
                isListExpanded={!compact}
                embedded={embedded}
                revealed={entry.id === revealId}
                onRevealComplete={onRevealComplete}
              />
            ))}
          </Stack>
        </EmbeddableScrollArea>
      )}
    </PanelContainer>
  );
}
