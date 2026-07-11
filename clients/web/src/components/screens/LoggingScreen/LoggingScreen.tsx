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
  ui: LogsUiState;
  onUiChange: (next: LogsUiState) => void;
  onSetLevel: (level: LoggingLevel) => void;
  onClear: () => void;
  onExport: () => void;
  sortDirection: SortDirection;
  onSortChange: (next: SortDirection) => void;
  /**
   * True when rendered inside the monitoring column: the screen fills its
   * parent's height (instead of the viewport calc) and drops the filter
   * sidebar so the narrow column is stream-only.
   */
  embedded?: boolean;
}

// Filter text + visible-level set — controlled by the parent (App) as one
// object so they persist across tab navigation within a live session (#1417).
export interface LogsUiState {
  filterText: string;
  visibleLevels: Record<LoggingLevel, boolean>;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100dvh - var(--app-shell-header-height, 0px))",
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
  ui,
  onUiChange,
  onSetLevel,
  onClear,
  onExport,
  sortDirection,
  onSortChange,
  embedded = false,
}: LoggingScreenProps) {
  const { filterText, visibleLevels } = ui;

  function handleToggleLevel(level: LoggingLevel, visible: boolean) {
    onUiChange({
      ...ui,
      visibleLevels: { ...visibleLevels, [level]: visible },
    });
  }

  function handleToggleAllLevels() {
    const allSelected = Object.values(visibleLevels).every(Boolean);
    onUiChange({
      ...ui,
      visibleLevels: allSelected ? NO_LEVELS_VISIBLE : ALL_LEVELS_VISIBLE,
    });
  }

  return (
    <ScreenLayout h={embedded ? "100%" : undefined}>
      {embedded ? null : (
        <Sidebar>
          <SidebarCard>
            <LogControls
              currentLevel={currentLevel}
              filterText={filterText}
              visibleLevels={visibleLevels}
              onSetLevel={onSetLevel}
              onFilterChange={(value) =>
                onUiChange({ ...ui, filterText: value })
              }
              onToggleLevel={handleToggleLevel}
              onToggleAllLevels={handleToggleAllLevels}
            />
          </SidebarCard>
        </Sidebar>
      )}
      <LogStreamPanel
        entries={entries}
        filterText={filterText}
        visibleLevels={visibleLevels}
        onClear={onClear}
        onExport={onExport}
        sortDirection={sortDirection}
        onSortChange={onSortChange}
        embedded={embedded}
      />
    </ScreenLayout>
  );
}
