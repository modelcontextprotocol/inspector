import { Card, Flex, Stack } from "@mantine/core";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { LogControls } from "../../groups/LogControls/LogControls";
import { LogStreamPanel } from "../../groups/LogStreamPanel/LogStreamPanel";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";
import type { SortDirection } from "../../elements/SortToggle/SortToggle";
import { ALL_LEVELS_VISIBLE, NO_LEVELS_VISIBLE } from "./logLevels";

export interface LoggingScreenProps {
  entries: LogEntryData[];
  currentLevel: LoggingLevel;
  // Filter text + visible-level set are controlled by the parent (App) so they
  // persist across tab navigation within a live session — see #1417.
  filterText?: string;
  visibleLevels?: Record<LoggingLevel, boolean>;
  onFilterChange: (value: string) => void;
  onVisibleLevelsChange: (value: Record<LoggingLevel, boolean>) => void;
  onSetLevel: (level: LoggingLevel) => void;
  onClear: () => void;
  onExport: () => void;
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

export function LoggingScreen({
  entries,
  currentLevel,
  filterText = "",
  visibleLevels = ALL_LEVELS_VISIBLE,
  onFilterChange,
  onVisibleLevelsChange,
  onSetLevel,
  onClear,
  onExport,
  sortDirection,
  onSortChange,
}: LoggingScreenProps) {
  function handleToggleLevel(level: LoggingLevel, visible: boolean) {
    onVisibleLevelsChange({ ...visibleLevels, [level]: visible });
  }

  function handleToggleAllLevels() {
    const allSelected = Object.values(visibleLevels).every(Boolean);
    onVisibleLevelsChange(allSelected ? NO_LEVELS_VISIBLE : ALL_LEVELS_VISIBLE);
  }

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <LogControls
            currentLevel={currentLevel}
            filterText={filterText}
            visibleLevels={visibleLevels}
            onSetLevel={onSetLevel}
            onFilterChange={onFilterChange}
            onToggleLevel={handleToggleLevel}
            onToggleAllLevels={handleToggleAllLevels}
          />
        </SidebarCard>
      </Sidebar>
      <LogStreamPanel
        entries={entries}
        filterText={filterText}
        visibleLevels={visibleLevels}
        onClear={onClear}
        onExport={onExport}
        sortDirection={sortDirection}
        onSortChange={onSortChange}
      />
    </ScreenLayout>
  );
}
