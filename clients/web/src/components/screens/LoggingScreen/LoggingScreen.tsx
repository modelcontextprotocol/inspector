import { Card, Flex, Stack } from "@mantine/core";
import type { LoggingLevel } from "@modelcontextprotocol/client";
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
   * True when rendered inside the monitoring sidebar: the screen fills its
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
    // Embedded fills the monitoring sidebar column (100%); standalone keeps the
    // ScreenLayout's default full-screen height. Passing `h={undefined}` here
    // would clobber that default (withProps plain-spreads), collapsing an empty
    // screen to its controls' height — so only override `h` when embedded.
    // Embedded also halves the top padding (`pt: md` vs the `xl` default) so the
    // panel sits closer to the sidebar's tab/search controls above it.
    <ScreenLayout {...(embedded ? { h: "100%", pt: "md" } : {})}>
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
