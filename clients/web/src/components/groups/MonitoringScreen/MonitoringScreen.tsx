import type { ReactNode } from "react";
import { Divider, Stack } from "@mantine/core";
import { MonitoringControls } from "../MonitoringControls/MonitoringControls";
import { ScreenStage } from "../../elements/ScreenStage/ScreenStage";

export interface MonitoringScreenProps {
  /** Available monitor tabs (Logs/Protocol/Network, filtered by capability). */
  tabs: string[];
  /** Active monitor tab; the matching screen is the mounted one below (the rest
   *  are cross-faded out via `ScreenStage`). */
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

// Relative-positioned host so each tab's `ScreenStage` (absolutely positioned)
// can cross-fade over it. `mih: 0` lets the inner ScrollArea bound its height.
const ScreenSlot = Stack.withProps({
  pos: "relative",
  flex: 1,
  mih: 0,
  gap: 0,
});

/**
 * The pinned monitoring column's content (#1616): a `MonitoringControls` tab row
 * over the selected monitor screen. Layout-only — it wraps each supplied screen
 * node in a `ScreenStage`, so switching tabs cross-fades (only the active tab's
 * screen is mounted) the same way the primary pane does.
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
      <ScreenSlot>
        {tabs.map((tab) => (
          <ScreenStage key={tab} active={tab === value} fill>
            {screens[tab]}
          </ScreenStage>
        ))}
      </ScreenSlot>
    </ColumnLayout>
  );
}
