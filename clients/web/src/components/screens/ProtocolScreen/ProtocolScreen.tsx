import { useCallback, useMemo } from "react";
import { Card, Flex, Stack } from "@mantine/core";
import type {
  MessageEntry,
  MessageMethod,
  MessageOrigin,
} from "@inspector/core/mcp/types.js";
import { ProtocolControls } from "../../groups/ProtocolControls/ProtocolControls";
import { ProtocolListPanel } from "../../groups/ProtocolListPanel/ProtocolListPanel.js";
import { extractMethod } from "../../groups/protocolUtils.js";
import type { SortDirection } from "../../elements/SortToggle/SortToggle";

export interface ProtocolScreenProps {
  entries: MessageEntry[];
  pinnedIds: Set<string>;
  ui: ProtocolUiState;
  onUiChange: (next: ProtocolUiState) => void;
  onClearAll: () => void;
  onExport: () => void;
  onClearSection: (section: "pinned" | "history") => void;
  onExportSection: (section: "pinned" | "history") => void;
  onReplay: (id: string) => void;
  onTogglePin: (id: string) => void;
  sortDirection: SortDirection;
  onSortChange: (next: SortDirection) => void;
  compact: boolean;
  onToggleCompact: () => void;
  /** See LoggingScreen: fills the parent height and drops the filter sidebar. */
  embedded?: boolean;
}

// Search text, method filter, and per-direction visibility — controlled by the
// parent (App) as one object so they persist across tab navigation within a
// live session (#1417).
export interface ProtocolUiState {
  search: string;
  methodFilter?: MessageMethod;
  /** Which message directions are shown, keyed by entry origin. */
  visibleDirections: Record<MessageOrigin, boolean>;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100dvh - var(--app-shell-header-height, 0px) - var(--app-shell-footer-height, 0px))",
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

export function ProtocolScreen({
  entries,
  pinnedIds,
  ui,
  onUiChange,
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
  embedded = false,
}: ProtocolScreenProps) {
  const { search, methodFilter, visibleDirections } = ui;

  const availableMethods = useMemo(
    () => Array.from(new Set(entries.map(extractMethod))).sort(),
    [entries],
  );

  const handleClearAll = useCallback(() => {
    onUiChange({ ...ui, methodFilter: undefined });
    onClearAll();
  }, [ui, onUiChange, onClearAll]);

  const handleToggleDirection = useCallback(
    (direction: MessageOrigin, visible: boolean) => {
      onUiChange({
        ...ui,
        visibleDirections: { ...visibleDirections, [direction]: visible },
      });
    },
    [ui, visibleDirections, onUiChange],
  );

  const handleToggleAllDirections = useCallback(() => {
    const next = !Object.values(visibleDirections).every(Boolean);
    onUiChange({
      ...ui,
      visibleDirections: { client: next, server: next },
    });
  }, [ui, visibleDirections, onUiChange]);

  return (
    // See LoggingScreen: only override `h` when embedded, so the standalone
    // screen keeps ScreenLayout's default full-screen height (a `h={undefined}`
    // would clobber it and collapse an empty screen to its controls' height).
    <ScreenLayout {...(embedded ? { h: "100%", pt: "md" } : {})}>
      {embedded ? null : (
        <Sidebar>
          <SidebarCard>
            <ProtocolControls
              searchText={search}
              methodFilter={methodFilter}
              availableMethods={availableMethods}
              visibleDirections={visibleDirections}
              onSearchChange={(value) => onUiChange({ ...ui, search: value })}
              onMethodFilterChange={(value) =>
                onUiChange({ ...ui, methodFilter: value })
              }
              onToggleDirection={handleToggleDirection}
              onToggleAllDirections={handleToggleAllDirections}
            />
          </SidebarCard>
        </Sidebar>
      )}
      <ProtocolListPanel
        entries={entries}
        pinnedIds={pinnedIds}
        searchText={search}
        methodFilter={methodFilter}
        visibleDirections={visibleDirections}
        onClearAll={handleClearAll}
        onExport={onExport}
        onClearSection={onClearSection}
        onExportSection={onExportSection}
        onReplay={onReplay}
        onTogglePin={onTogglePin}
        sortDirection={sortDirection}
        onSortChange={onSortChange}
        compact={compact}
        onToggleCompact={onToggleCompact}
        embedded={embedded}
      />
    </ScreenLayout>
  );
}
