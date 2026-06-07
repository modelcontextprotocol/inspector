import { ActionIcon } from "@mantine/core";
import { RiCollapseVerticalLine, RiExpandVerticalLine } from "react-icons/ri";

export interface ExpandToggleProps {
  /** Whether the owning entry is currently expanded. */
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Icon toggle for a per-entry expand/collapse control (History, Network, and
 * Task cards). Uses the same expand/collapse-vertical icons as the list-level
 * ListToggle: collapsed shows the expand icon, expanded shows the collapse
 * icon. The aria-label stays "Expand"/"Collapse" so it reads the same as the
 * text button it replaced.
 */
export function ExpandToggle({ expanded, onToggle }: ExpandToggleProps) {
  const Icon = expanded ? RiCollapseVerticalLine : RiExpandVerticalLine;
  const label = expanded ? "Collapse" : "Expand";
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="md"
      aria-label={label}
      onClick={onToggle}
    >
      <Icon size={16} />
    </ActionIcon>
  );
}
