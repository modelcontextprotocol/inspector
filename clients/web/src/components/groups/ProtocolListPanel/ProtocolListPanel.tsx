import { useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Collapse,
  Group,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import type {
  MessageEntry,
  MessageMethod,
  MessageOrigin,
} from "@inspector/core/mcp/types.js";
import { ProtocolEntry } from "../ProtocolEntry/ProtocolEntry";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import {
  SortToggle,
  type SortDirection,
} from "../../elements/SortToggle/SortToggle";
import { PinColumnButton } from "../../elements/PinColumnButton/PinColumnButton";
import { EmbeddableScrollArea } from "../../elements/EmbeddableScrollArea/EmbeddableScrollArea";
import { extractMethod } from "../protocolUtils.js";
import { useScrollMemory } from "../../../hooks/useScrollMemory";

export interface ProtocolListPanelProps {
  entries: MessageEntry[];
  pinnedIds: Set<string>;
  searchText: string;
  methodFilter?: MessageMethod;
  /** Which message directions to show, keyed by entry origin. */
  visibleDirections: Record<MessageOrigin, boolean>;
  onClearAll: () => void;
  onExport: () => void;
  /** Clear just one section's entries (pinned vs unpinned history). */
  onClearSection: (section: ProtocolSectionName) => void;
  /** Export just one section's entries. */
  onExportSection: (section: ProtocolSectionName) => void;
  onReplay: (id: string) => void;
  onTogglePin: (id: string) => void;
  sortDirection: SortDirection;
  onSortChange: (next: SortDirection) => void;
  compact: boolean;
  onToggleCompact: () => void;
  /** See LogStreamPanel: shows a "pin as column" button when set (#1616). */
  onPin?: () => void;
  /** See LogStreamPanel: fills the flex parent instead of the viewport calc. */
  embedded?: boolean;
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

// The section header is a single "pleat" bar (rounded, with the filter-button
// outline-on-hover treatment and the active background passed per instance via
// `bg`). Inside it sit the
// clickable toggle area (the title, filling the left) and the optional
// Clear/Export actions on the right — so the actions live on the pleat itself,
// not beside it. The toggle is its own button (the actions can't nest inside a
// button), `flex: 1` so it spans the bar up to the actions.
const SectionHeaderBar = Group.withProps({
  variant: "sectionHeader",
  gap: "sm",
  wrap: "nowrap",
  p: "sm",
});

const SectionToggleArea = UnstyledButton.withProps({
  flex: 1,
});

const SectionTitle = Text.withProps({
  fw: 600,
});

const SectionActionGroup = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
});

// Subtle link-style button, matching the Select/Deselect All control in
// ProtocolControls.
const SectionLinkButton = Button.withProps({
  variant: "subtle",
  size: "xs",
});

function formatPinnedTitle(count: number): string {
  return `Pinned Messages (${count})`;
}

function formatHistoryTitle(count: number): string {
  return `History (${count})`;
}

type ProtocolSectionName = "pinned" | "history";

// Per-section Clear / Export links, shown to the right of a section header when
// both sections are present (so each can be cleared/exported on its own).
function SectionActions({
  onClear,
  onExport,
}: {
  onClear: () => void;
  onExport: () => void;
}) {
  return (
    <SectionActionGroup>
      <SectionLinkButton onClick={onClear}>Clear</SectionLinkButton>
      <SectionLinkButton onClick={onExport}>Export</SectionLinkButton>
    </SectionActionGroup>
  );
}

// A History section. When `collapsible` (both sections are on screen) the header
// is a `listItem` toggle — with an optional actions slot on the right — over a
// `Collapse` of the entries. When it's the only section, the accordion makes no
// sense: the header is a plain title and the entries always show (so a stale
// collapsed state from when both sections were present can't hide them) —
// unless `hideHeaderWhenAlone`, in which case the lone section drops its title
// entirely (the "Protocol" label is redundant when there's nothing to
// distinguish it from).
function CollapsibleSection({
  title,
  collapsible,
  hideHeaderWhenAlone = false,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string;
  collapsible: boolean;
  hideHeaderWhenAlone?: boolean;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  if (!collapsible) {
    return (
      <Stack gap="md">
        {hideHeaderWhenAlone ? null : <Title order={5}>{title}</Title>}
        <Stack gap="md">{children}</Stack>
      </Stack>
    );
  }
  return (
    <Stack gap="md">
      <SectionHeaderBar
        bg={open ? "var(--mantine-primary-color-light)" : undefined}
      >
        <SectionToggleArea aria-expanded={open} onClick={onToggle}>
          <SectionTitle>{title}</SectionTitle>
        </SectionToggleArea>
        {actions}
      </SectionHeaderBar>
      <Collapse in={open}>
        <Stack gap="md">{children}</Stack>
      </Collapse>
    </Stack>
  );
}

function matchesFilters(
  entry: MessageEntry,
  searchText: string,
  visibleDirections: Record<MessageOrigin, boolean>,
  methodFilter: MessageMethod | undefined,
  // The embedded column exposes only the search box (no direction/method
  // controls), so it applies the text filter but skips those (#1616).
  ignoreDirectionAndMethod: boolean,
): boolean {
  const method = extractMethod(entry);
  if (!ignoreDirectionAndMethod) {
    // Hide a direction when its toggle is off. Entries with no recorded origin
    // (legacy / pre-origin logs) are never filtered out by direction.
    if (entry.origin && !visibleDirections[entry.origin]) return false;
    if (methodFilter && method !== methodFilter) return false;
  }
  if (searchText) {
    const term = searchText.toLowerCase();
    const responseText = entry.response ? JSON.stringify(entry.response) : "";
    const searchable =
      `${method} ${entry.id} ${JSON.stringify(entry.message)} ${responseText}`.toLowerCase();
    if (!searchable.includes(term)) return false;
  }
  return true;
}

export function ProtocolListPanel({
  entries,
  pinnedIds,
  searchText,
  methodFilter,
  visibleDirections,
  onClearAll,
  onExport,
  onClearSection,
  onExportSection,
  onReplay,
  onTogglePin,
  sortDirection,
  onSortChange,
  compact,
  onToggleCompact,
  onPin,
  embedded = false,
}: ProtocolListPanelProps) {
  const viewportRef = useScrollMemory("protocol-list");
  // Per-section expand/collapse, like the LogControls level toggles. Both start
  // open; collapsing hides that section's entries without affecting the other.
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const filteredEntries = useMemo(() => {
    // Embedded column filters by text only (its direction/method controls live
    // in the full-size sidebar). See LogStreamPanel (#1616). `.filter()` returns
    // a fresh array, so sorting in-place is safe.
    const sorted = entries
      .filter((e) =>
        matchesFilters(
          e,
          searchText,
          visibleDirections,
          methodFilter,
          embedded,
        ),
      )
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    if (sortDirection === "newest-first") sorted.reverse();
    return sorted;
  }, [
    entries,
    searchText,
    visibleDirections,
    methodFilter,
    sortDirection,
    embedded,
  ]);

  const pinnedEntries = useMemo(
    () => filteredEntries.filter((e) => pinnedIds.has(e.id)),
    [filteredEntries, pinnedIds],
  );

  const unpinnedEntries = useMemo(
    () => filteredEntries.filter((e) => !pinnedIds.has(e.id)),
    [filteredEntries, pinnedIds],
  );

  const hasResults = filteredEntries.length > 0;
  // Per-section Clear/Export only make sense when both sections are on screen;
  // with a single section the panel-level Clear/Export already covers it.
  const bothSections = pinnedEntries.length > 0 && unpinnedEntries.length > 0;

  return (
    <PanelContainer>
      <Group justify="space-between" mb="sm">
        <Title order={4}>Messages</Title>
        <Group gap="xs">
          <SortToggle
            value={sortDirection}
            onChange={onSortChange}
            aria-label="History sort direction"
          />
          <Button
            variant="default"
            onClick={onClearAll}
            disabled={unpinnedEntries.length === 0}
          >
            Clear
          </Button>
          <Button variant="default" onClick={onExport} disabled={!hasResults}>
            Export
          </Button>
          {hasResults && (
            <ListToggle compact={compact} onToggle={onToggleCompact} />
          )}
          {onPin ? <PinColumnButton onPin={onPin} /> : null}
        </Group>
      </Group>

      {!hasResults ? (
        <EmptyState>No request history</EmptyState>
      ) : (
        <EmbeddableScrollArea embedded={embedded} viewportRef={viewportRef}>
          <Stack gap="md">
            {pinnedEntries.length > 0 && (
              <CollapsibleSection
                title={formatPinnedTitle(pinnedEntries.length)}
                collapsible={bothSections}
                open={pinnedOpen}
                onToggle={() => setPinnedOpen((v) => !v)}
                actions={
                  bothSections ? (
                    <SectionActions
                      onClear={() => onClearSection("pinned")}
                      onExport={() => onExportSection("pinned")}
                    />
                  ) : undefined
                }
              >
                {pinnedEntries.map((entry) => (
                  <ProtocolEntry
                    key={entry.id}
                    entry={entry}
                    isPinned={true}
                    isListExpanded={!compact}
                    embedded={embedded}
                    onReplay={() => onReplay(entry.id)}
                    onTogglePin={() => onTogglePin(entry.id)}
                  />
                ))}
              </CollapsibleSection>
            )}

            {unpinnedEntries.length > 0 && (
              <CollapsibleSection
                title={formatHistoryTitle(unpinnedEntries.length)}
                collapsible={bothSections}
                // With no pinned section to distinguish it from, the lone
                // "History (N)" header is redundant — drop it.
                hideHeaderWhenAlone
                open={historyOpen}
                onToggle={() => setHistoryOpen((v) => !v)}
                actions={
                  bothSections ? (
                    <SectionActions
                      onClear={() => onClearSection("history")}
                      onExport={() => onExportSection("history")}
                    />
                  ) : undefined
                }
              >
                {unpinnedEntries.map((entry) => (
                  <ProtocolEntry
                    key={entry.id}
                    entry={entry}
                    isPinned={false}
                    isListExpanded={!compact}
                    embedded={embedded}
                    onReplay={() => onReplay(entry.id)}
                    onTogglePin={() => onTogglePin(entry.id)}
                  />
                ))}
              </CollapsibleSection>
            )}
          </Stack>
        </EmbeddableScrollArea>
      )}
    </PanelContainer>
  );
}
