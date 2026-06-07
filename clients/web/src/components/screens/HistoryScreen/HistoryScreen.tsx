import { useCallback, useMemo } from "react";
import { Card, Flex, Stack } from "@mantine/core";
import type { MessageEntry, MessageMethod } from "@inspector/core/mcp/types.js";
import { HistoryControls } from "../../groups/HistoryControls/HistoryControls";
import { HistoryListPanel } from "../../groups/HistoryListPanel/HistoryListPanel.js";
import { extractMethod } from "../../groups/historyUtils.js";
import type { SortDirection } from "../../elements/SortToggle/SortToggle";

export interface HistoryScreenProps {
  entries: MessageEntry[];
  pinnedIds: Set<string>;
  ui: HistoryUiState;
  onUiChange: (next: HistoryUiState) => void;
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
}

// Search text + method filter — controlled by the parent (App) as one object so
// they persist across tab navigation within a live session (#1417).
export interface HistoryUiState {
  search: string;
  methodFilter?: MessageMethod;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
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

export function HistoryScreen({
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
}: HistoryScreenProps) {
  const { search, methodFilter } = ui;

  const availableMethods = useMemo(
    () => Array.from(new Set(entries.map(extractMethod))).sort(),
    [entries],
  );

  const handleClearAll = useCallback(() => {
    onUiChange({ ...ui, methodFilter: undefined });
    onClearAll();
  }, [ui, onUiChange, onClearAll]);

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <HistoryControls
            searchText={search}
            methodFilter={methodFilter}
            availableMethods={availableMethods}
            onSearchChange={(value) => onUiChange({ ...ui, search: value })}
            onMethodFilterChange={(value) =>
              onUiChange({ ...ui, methodFilter: value })
            }
          />
        </SidebarCard>
      </Sidebar>
      <HistoryListPanel
        entries={entries}
        pinnedIds={pinnedIds}
        searchText={search}
        methodFilter={methodFilter}
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
      />
    </ScreenLayout>
  );
}
