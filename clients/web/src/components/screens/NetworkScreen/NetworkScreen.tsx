import { Card, Flex, Stack } from "@mantine/core";
import type {
  FetchRequestCategory,
  FetchRequestEntry,
  MessageOrigin,
} from "@inspector/core/mcp/types.js";
import { NetworkControls } from "../../groups/NetworkControls/NetworkControls";
import { NetworkStreamPanel } from "../../groups/NetworkStreamPanel/NetworkStreamPanel";
import type { SortDirection } from "../../elements/SortToggle/SortToggle";
import {
  ALL_CATEGORIES_VISIBLE,
  NO_CATEGORIES_VISIBLE,
} from "./fetchCategories";

export interface NetworkScreenProps {
  entries: FetchRequestEntry[];
  ui: NetworkUiState;
  onUiChange: (next: NetworkUiState) => void;
  onClear: () => void;
  onExport: () => void;
  sortDirection: SortDirection;
  onSortChange: (next: SortDirection) => void;
  compact: boolean;
  onToggleCompact: () => void;
}

// Filter text + visible-category set + visible-direction set — controlled by
// the parent (App) as one object so they persist across tab navigation within a
// live session (#1417).
export interface NetworkUiState {
  filterText: string;
  visibleCategories: Record<FetchRequestCategory, boolean>;
  /**
   * Which message directions are shown. Network fetches are always
   * inspector-originated (client → server), so toggling "client ← server" off
   * hides nothing — the section mirrors the History one for parity.
   */
  visibleDirections: Record<MessageOrigin, boolean>;
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

export function NetworkScreen({
  entries,
  ui,
  onUiChange,
  onClear,
  onExport,
  sortDirection,
  onSortChange,
  compact,
  onToggleCompact,
}: NetworkScreenProps) {
  const { filterText, visibleCategories, visibleDirections } = ui;

  function handleToggleCategory(
    category: FetchRequestCategory,
    visible: boolean,
  ) {
    onUiChange({
      ...ui,
      visibleCategories: { ...visibleCategories, [category]: visible },
    });
  }

  function handleToggleAllCategories() {
    const allSelected = Object.values(visibleCategories).every(Boolean);
    onUiChange({
      ...ui,
      visibleCategories: allSelected
        ? NO_CATEGORIES_VISIBLE
        : ALL_CATEGORIES_VISIBLE,
    });
  }

  function handleToggleDirection(direction: MessageOrigin, visible: boolean) {
    onUiChange({
      ...ui,
      visibleDirections: { ...visibleDirections, [direction]: visible },
    });
  }

  function handleToggleAllDirections() {
    const next = !Object.values(visibleDirections).every(Boolean);
    onUiChange({
      ...ui,
      visibleDirections: { client: next, server: next },
    });
  }

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <NetworkControls
            filterText={filterText}
            visibleCategories={visibleCategories}
            visibleDirections={visibleDirections}
            onFilterChange={(value) => onUiChange({ ...ui, filterText: value })}
            onToggleCategory={handleToggleCategory}
            onToggleAllCategories={handleToggleAllCategories}
            onToggleDirection={handleToggleDirection}
            onToggleAllDirections={handleToggleAllDirections}
          />
        </SidebarCard>
      </Sidebar>
      <NetworkStreamPanel
        entries={entries}
        filterText={filterText}
        visibleCategories={visibleCategories}
        visibleDirections={visibleDirections}
        onClear={onClear}
        onExport={onExport}
        sortDirection={sortDirection}
        onSortChange={onSortChange}
        compact={compact}
        onToggleCompact={onToggleCompact}
      />
    </ScreenLayout>
  );
}
