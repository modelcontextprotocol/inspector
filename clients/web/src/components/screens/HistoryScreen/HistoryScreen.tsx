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
  // Search text + method filter are controlled by the parent (App) so they
  // persist across tab navigation within a live session — see #1417.
  searchText?: string;
  methodFilter?: MessageMethod;
  onSearchChange: (value: string) => void;
  onMethodFilterChange: (value: MessageMethod | undefined) => void;
  onClearAll: () => void;
  onExport: () => void;
  onReplay: (id: string) => void;
  onTogglePin: (id: string) => void;
  sortDirection: SortDirection;
  onSortChange: (next: SortDirection) => void;
  compact: boolean;
  onToggleCompact: () => void;
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
  searchText = "",
  methodFilter,
  onSearchChange,
  onMethodFilterChange,
  onClearAll,
  onExport,
  onReplay,
  onTogglePin,
  sortDirection,
  onSortChange,
  compact,
  onToggleCompact,
}: HistoryScreenProps) {
  const availableMethods = useMemo(
    () => Array.from(new Set(entries.map(extractMethod))).sort(),
    [entries],
  );

  const handleClearAll = useCallback(() => {
    onMethodFilterChange(undefined);
    onClearAll();
  }, [onMethodFilterChange, onClearAll]);

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <HistoryControls
            searchText={searchText}
            methodFilter={methodFilter}
            availableMethods={availableMethods}
            onSearchChange={onSearchChange}
            onMethodFilterChange={onMethodFilterChange}
          />
        </SidebarCard>
      </Sidebar>
      <HistoryListPanel
        entries={entries}
        pinnedIds={pinnedIds}
        searchText={searchText}
        methodFilter={methodFilter}
        onClearAll={handleClearAll}
        onExport={onExport}
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
