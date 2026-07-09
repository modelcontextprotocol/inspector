import type { ReactNode } from "react";
import { Divider, Stack } from "@mantine/core";
import { MonitoringControls } from "../MonitoringControls/MonitoringControls";

export interface MonitoringScreenProps {
  /** Available monitor tabs (Logs/History/Network, filtered by capability). */
  tabs: string[];
  /** Active monitor tab; keys into `screens` to pick what renders below. */
  value: string;
  onChange: (tab: string) => void;
  /** Search text for the active screen; wired by the caller to its filter state. */
  searchValue: string;
  onSearchChange: (next: string) => void;
  onClose: () => void;
  /**
   * The embedded screen node for each tab, keyed by tab label. The caller builds
   * these (with `embedded` set) so this component stays a pure layout shell.
   */
  screens: Record<string, ReactNode>;
}

// Fills the pinned column: a fixed controls row on top and the selected screen
// filling the remaining height below (mih:0 lets the inner ScrollArea bound).
const ColumnLayout = Stack.withProps({
  h: "100%",
  gap: 0,
});

const ScreenSlot = Stack.withProps({
  flex: 1,
  mih: 0,
  gap: 0,
});

/**
 * The pinned monitoring column's content (#1616): a `MonitoringControls` tab row
 * over the currently-selected monitor screen. Layout-only — it renders whichever
 * embedded screen node the caller supplies for the active tab.
 */
export function MonitoringScreen({
  tabs,
  value,
  onChange,
  searchValue,
  onSearchChange,
  onClose,
  screens,
}: MonitoringScreenProps) {
  return (
    <ColumnLayout>
      <MonitoringControls
        tabs={tabs}
        value={value}
        onChange={onChange}
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        onClose={onClose}
      />
      <Divider />
      <ScreenSlot>{screens[value]}</ScreenSlot>
    </ColumnLayout>
  );
}
