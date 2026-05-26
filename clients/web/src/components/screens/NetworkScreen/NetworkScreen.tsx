import { useState } from "react";
import { Card, Flex, Stack } from "@mantine/core";
import type {
  FetchRequestCategory,
  FetchRequestEntry,
} from "@inspector/core/mcp/types.js";
import { NetworkControls } from "../../groups/NetworkControls/NetworkControls";
import { NetworkStreamPanel } from "../../groups/NetworkStreamPanel/NetworkStreamPanel";

export interface NetworkScreenProps {
  entries: FetchRequestEntry[];
  onClear: () => void;
  onExport: () => void;
}

const ALL_CATEGORIES_VISIBLE: Record<FetchRequestCategory, boolean> = {
  auth: true,
  transport: true,
};

const NO_CATEGORIES_VISIBLE: Record<FetchRequestCategory, boolean> = {
  auth: false,
  transport: false,
};

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

export function NetworkScreen({
  entries,
  onClear,
  onExport,
}: NetworkScreenProps) {
  const [filterText, setFilterText] = useState("");
  const [visibleCategories, setVisibleCategories] = useState<
    Record<FetchRequestCategory, boolean>
  >(ALL_CATEGORIES_VISIBLE);

  function handleToggleCategory(
    category: FetchRequestCategory,
    visible: boolean,
  ) {
    setVisibleCategories((prev) => ({ ...prev, [category]: visible }));
  }

  function handleToggleAllCategories() {
    const allSelected = Object.values(visibleCategories).every(Boolean);
    setVisibleCategories(
      allSelected ? NO_CATEGORIES_VISIBLE : ALL_CATEGORIES_VISIBLE,
    );
  }

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <NetworkControls
            filterText={filterText}
            visibleCategories={visibleCategories}
            onFilterChange={setFilterText}
            onToggleCategory={handleToggleCategory}
            onToggleAllCategories={handleToggleAllCategories}
          />
        </SidebarCard>
      </Sidebar>
      <NetworkStreamPanel
        entries={entries}
        filterText={filterText}
        visibleCategories={visibleCategories}
        onClear={onClear}
        onExport={onExport}
      />
    </ScreenLayout>
  );
}
