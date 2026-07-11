import { ActionIcon, Tooltip } from "@mantine/core";
import { TiPin, TiPinOutline } from "react-icons/ti";

export interface PinToggleProps {
  /** Whether the owning entry is currently pinned. */
  pinned: boolean;
  onToggle: () => void;
}

/**
 * Icon toggle for pinning an entry. Unpinned shows an outline pin; pinned shows
 * a filled pin. The aria-label stays "Pin"/"Unpin" so it reads the same as the
 * text button it replaces.
 */
export function PinToggle({ pinned, onToggle }: PinToggleProps) {
  const Icon = pinned ? TiPin : TiPinOutline;
  const label = pinned ? "Unpin" : "Pin";
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="md"
        aria-label={label}
        onClick={onToggle}
      >
        <Icon size={18} />
      </ActionIcon>
    </Tooltip>
  );
}
