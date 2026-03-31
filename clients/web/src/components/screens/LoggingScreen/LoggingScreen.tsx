import { useState } from "react";
import { Card, Flex, Stack } from "@mantine/core";
import { LogControls } from "../../groups/LogControls/LogControls";
import { LogStreamPanel } from "../../groups/LogStreamPanel/LogStreamPanel";
import type { LogEntryProps } from "../../elements/LogEntry/LogEntry";

export interface LoggingScreenProps {
  entries: LogEntryProps[];
  currentLevel: string;
  onSetLevel: (level: string) => void;
  onClear: () => void;
  onExport: () => void;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  onCopyAll: () => void;
}

const ALL_LEVELS_VISIBLE: Record<string, boolean> = {
  debug: true,
  info: true,
  notice: true,
  warning: true,
  error: true,
  critical: true,
  alert: true,
  emergency: true,
};

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
  gap: "xl",
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
    useState<Record<string, boolean>>(ALL_LEVELS_VISIBLE);

  function handleToggleLevel(level: string, visible: boolean) {
    setVisibleLevels((prev) => ({ ...prev, [level]: visible }));
  }

  const NO_LEVELS_VISIBLE: Record<string, boolean> = Object.fromEntries(
    Object.keys(ALL_LEVELS_VISIBLE).map((k) => [k, false]),
  );

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
