import { useState } from "react";
import { Card, Flex, Stack } from "@mantine/core";
import { HistoryControls } from "../../groups/HistoryControls/HistoryControls";
import { HistoryListPanel } from "../../groups/HistoryListPanel/HistoryListPanel.js";
import type { HistoryEntryProps } from "../../groups/HistoryEntry/HistoryEntry";

export interface HistoryScreenProps {
  entries: HistoryEntryProps[];
  pinnedEntries: HistoryEntryProps[];
  onClearAll: () => void;
  onExport: () => void;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
  gap: "xl",
  p: "xl",
});

const Sidebar = Stack.withProps({
  w: 280,
  flex: "0 0 auto",
});

const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

export function HistoryScreen({
  entries,
  pinnedEntries,
  onClearAll,
  onExport,
}: HistoryScreenProps) {
  const [searchText, setSearchText] = useState("");
  const [methodFilter, setMethodFilter] = useState<string | undefined>();

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <HistoryControls
            searchText={searchText}
            methodFilter={methodFilter}
            onSearchChange={setSearchText}
            onMethodFilterChange={(value) =>
              setMethodFilter(value || undefined)
            }
            onClearAll={onClearAll}
            onExport={onExport}
          />
        </SidebarCard>
      </Sidebar>
      <HistoryListPanel
        entries={entries}
        pinnedEntries={pinnedEntries}
        searchText={searchText}
        methodFilter={methodFilter}
      />
    </ScreenLayout>
  );
}
