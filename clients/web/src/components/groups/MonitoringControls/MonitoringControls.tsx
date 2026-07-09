import { ActionIcon, Group, SegmentedControl, TextInput } from "@mantine/core";
import { TbLayoutSidebarRightCollapse } from "react-icons/tb";
import { ClearButton } from "../../elements/ClearButton/ClearButton";

export interface MonitoringControlsProps {
  /** The monitor screens currently available to pin (e.g. Logs/History/Network). */
  tabs: string[];
  /** The active monitor tab shown in the column below. */
  value: string;
  onChange: (tab: string) => void;
  /** Search text for the active screen (shares the screen's own filter state). */
  searchValue: string;
  onSearchChange: (next: string) => void;
  /** Close the monitoring column, returning its screens to the header menu. */
  onClose: () => void;
}

// The controls row at the top of the pinned monitoring column: a segmented tab
// switcher on the left, a search box filling the middle, and a close button on
// the right that unpins the whole column.
const ControlsBar = Group.withProps({
  wrap: "nowrap",
  gap: "sm",
  p: "sm",
});

// Search box, styled to match the `*Controls` search fields; `flex:1`/`miw:0`
// so it fills the space between the tabs and the close button.
const SearchInput = TextInput.withProps({
  placeholder: "Search...",
  size: "sm",
  flex: 1,
  miw: 0,
  "aria-label": "Search",
});

/**
 * Tab row + search + close control for the pinned monitoring column (#1616).
 * Renders only the currently-available monitor tabs (the caller filters by
 * capability), so it never shows an empty switcher. Selecting a tab swaps the
 * screen below; the search box filters the shown screen (wired by the caller to
 * that screen's own filter state); the close button unpins the column so its
 * screens rejoin the header tab menu.
 */
export function MonitoringControls({
  tabs,
  value,
  onChange,
  searchValue,
  onSearchChange,
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
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        aria-label="Close monitoring column"
        onClick={onClose}
      >
        <TbLayoutSidebarRightCollapse size={20} />
      </ActionIcon>
    </ControlsBar>
  );
}
