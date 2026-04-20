import { useState } from "react";
import { Card, Flex, Stack } from "@mantine/core";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { LogControls } from "../../groups/LogControls/LogControls";
import { LogStreamPanel } from "../../groups/LogStreamPanel/LogStreamPanel";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";

export interface LoggingScreenProps {
  entries: LogEntryData[];
  currentLevel: LoggingLevel;
  onSetLevel: (level: LoggingLevel) => void;
  onClear: () => void;
  onExport: () => void;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  onCopyAll: () => void;
}

const ALL_LEVELS_VISIBLE: Record<LoggingLevel, boolean> = {
  debug: true,
  info: true,
  notice: true,
  warning: true,
  error: true,
  critical: true,
  alert: true,
  emergency: true,
};

const NO_LEVELS_VISIBLE: Record<LoggingLevel, boolean> = {
  debug: false,
  info: false,
  notice: false,
  warning: false,
  error: false,
  critical: false,
  alert: false,
  emergency: false,
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

export function LoggingScreen({
  entries,
  currentLevel,
  onSetLevel,
  onClear,
  onExport,
  autoScroll,
  onToggleAutoScroll,
  onCopyAll,
}: LoggingScreenProps) {
  const [filterText, setFilterText] = useState("");
  const [visibleLevels, setVisibleLevels] =
    useState<Record<LoggingLevel, boolean>>(ALL_LEVELS_VISIBLE);

  function handleToggleLevel(level: LoggingLevel, visible: boolean) {
    setVisibleLevels((prev) => ({ ...prev, [level]: visible }));
  }

  function handleToggleAllLevels() {
    const allSelected = Object.values(visibleLevels).every(Boolean);
    setVisibleLevels(allSelected ? NO_LEVELS_VISIBLE : ALL_LEVELS_VISIBLE);
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
            onFilterChange={setFilterText}
            onToggleLevel={handleToggleLevel}
            onToggleAllLevels={handleToggleAllLevels}
          />
        </SidebarCard>
      </Sidebar>
      <LogStreamPanel
        entries={entries}
        filterText={filterText}
        visibleLevels={visibleLevels}
        autoScroll={autoScroll}
        onToggleAutoScroll={onToggleAutoScroll}
        onCopyAll={onCopyAll}
        onClear={onClear}
        onExport={onExport}
      />
    </ScreenLayout>
  );
}
