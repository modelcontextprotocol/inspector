import { useCallback, useMemo, useState } from "react";
import { Card, Flex, Stack } from "@mantine/core";
import type { MessageEntry, MessageMethod } from "@inspector/core/mcp/types.js";
import { HistoryControls } from "../../groups/HistoryControls/HistoryControls";
import { HistoryListPanel } from "../../groups/HistoryListPanel/HistoryListPanel.js";
import { extractMethod } from "../../groups/historyUtils.js";
import type { SortDirection } from "../../elements/SortToggle/SortToggle";

export interface HistoryScreenProps {
  entries: MessageEntry[];
  pinnedIds: Set<string>;
  onClearAll: () => void;
  onExport: () => void;
  onReplay: (id: string) => void;
  onTogglePin: (id: string) => void;
  sortDirection: SortDirection;
  onSortChange: (next: SortDirection) => void;
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
  onClearAll,
  onExport,
  onReplay,
  onTogglePin,
  sortDirection,
  onSortChange,
}: HistoryScreenProps) {
  const [searchText, setSearchText] = useState("");
  const [methodFilter, setMethodFilter] = useState<MessageMethod | undefined>();

  const availableMethods = useMemo(
    () => Array.from(new Set(entries.map(extractMethod))).sort(),
    [entries],
  );

  const handleClearAll = useCallback(() => {
    setMethodFilter(undefined);
    onClearAll();
  }, [onClearAll]);

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <HistoryControls
            searchText={searchText}
            methodFilter={methodFilter}
            availableMethods={availableMethods}
            onSearchChange={setSearchText}
            onMethodFilterChange={setMethodFilter}
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
      />
    </ScreenLayout>
  );
}
