import { CloseButton, Group, SegmentedControl } from "@mantine/core";

export interface MonitoringControlsProps {
  /** The monitor screens currently available to pin (e.g. Logs/History/Network). */
  tabs: string[];
  /** The active monitor tab shown in the column below. */
  value: string;
  onChange: (tab: string) => void;
  /** Close the monitoring column, returning its screens to the header menu. */
  onClose: () => void;
}

// The controls row that sits at the top of the pinned monitoring column: a
// segmented tab switcher on the left, a close button on the right that unpins
// the whole column.
const ControlsBar = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
  gap: "sm",
  p: "sm",
});

/**
 * Tab row + close control for the pinned monitoring column (#1616). Renders only
 * the currently-available monitor tabs (the caller filters by capability), so it
 * never shows an empty switcher. Selecting a tab swaps the screen below; the
 * close button unpins the column so its screens rejoin the header tab menu.
 */
export function MonitoringControls({
  tabs,
  value,
  onChange,
  onClose,
}: MonitoringControlsProps) {
  return (
    <ControlsBar>
      <SegmentedControl
        size="sm"
        value={value}
        onChange={onChange}
        data={tabs}
        aria-label="Monitoring screen"
      />
      <CloseButton aria-label="Close monitoring column" onClick={onClose} />
    </ControlsBar>
  );
}
