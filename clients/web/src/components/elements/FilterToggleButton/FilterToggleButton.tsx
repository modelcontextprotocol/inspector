import { Text, UnstyledButton } from "@mantine/core";

export interface FilterToggleButtonProps {
  /** Visible label and accessible name for the toggle. */
  label: string;
  /** Mantine text color for the label (e.g. "blue", "red", "dimmed"). */
  color: string;
  /** Whether the filter is currently on (rendered as a filled background). */
  active: boolean;
  /** Receives the next desired active state when the button is clicked. */
  onToggle: (active: boolean) => void;
}

const ToggleLabel = Text.withProps({
  ta: "center",
  fw: 500,
});

/**
 * A single full-width filter toggle used by the Logging, Protocol, and Network
 * controls. The `filterToggle` theme variant + `.filter-toggle` rules own the
 * styling: hover shows a thin border, the active (`aria-pressed`) state shows a
 * filled background. Keeping hover as a border (not a fill) means toggling a
 * button off while the cursor is still over it is visibly distinct from hover,
 * instead of the two states sharing the same background. See issue #1460.
 */
export function FilterToggleButton({
  label,
  color,
  active,
  onToggle,
}: FilterToggleButtonProps) {
  return (
    <UnstyledButton
      w="100%"
      p="sm"
      variant="filterToggle"
      aria-pressed={active}
      onClick={() => onToggle(!active)}
    >
      <ToggleLabel c={color}>{label}</ToggleLabel>
    </UnstyledButton>
  );
}
