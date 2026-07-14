import { Group, SegmentedControl, TextInput } from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";

export interface MonitoringControlsProps {
  /** The monitor screens currently available to pin (e.g. Logs/Protocol/Network). */
  tabs: string[];
  /** The active monitor tab shown in the column below. */
  value: string;
  onChange: (tab: string) => void;
  /** Search text for the active screen (shares the screen's own filter state). */
  searchValue: string;
  onSearchChange: (next: string) => void;
}

// The controls row at the top of the pinned monitoring sidebar: a segmented tab
// switcher on the left and a search box filling the rest. The column is closed
// from the single header MonitoringToggle (#1661), so there is no close button
// here. `px: xl` matches the `xl` horizontal inset the embedded screen below
// gives its panel (its `ScreenLayout` padding), so the tabs + search span the
// same width as the content and line up with its left/right edges.
const ControlsBar = Group.withProps({
  wrap: "nowrap",
  gap: "sm",
  px: "xl",
  py: "sm",
});

// Search box, styled to match the `*Controls` search fields; `flex:1`/`miw:0`
// so it fills the space between the tabs and the row's edge.
const SearchInput = TextInput.withProps({
  placeholder: "Search...",
  size: "sm",
  flex: 1,
  miw: 0,
  "aria-label": "Search",
});

/**
 * Tab row + search for the pinned monitoring sidebar (#1616). Renders only the
 * currently-available monitor tabs (the caller filters by capability), so it
 * never shows an empty switcher. Selecting a tab swaps the screen below; the
 * search box filters the shown screen (wired by the caller to that screen's own
 * filter state). Opening/closing the column is handled by the single header
 * MonitoringToggle (#1661).
 */
export function MonitoringControls({
  tabs,
  value,
  onChange,
  searchValue,
  onSearchChange,
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
      <SearchInput
        value={searchValue}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
        rightSectionPointerEvents="auto"
        rightSection={
          searchValue ? (
            <ClearButton onClick={() => onSearchChange("")} />
          ) : null
        }
      />
    </ControlsBar>
  );
}
