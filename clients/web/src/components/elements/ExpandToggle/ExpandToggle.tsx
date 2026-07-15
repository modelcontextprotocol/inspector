import { ActionIcon, Tooltip } from "@mantine/core";
import { RiCollapseVerticalLine, RiExpandVerticalLine } from "react-icons/ri";

export interface ExpandToggleProps {
  /** Whether the owning entry is currently expanded. */
  expanded: boolean;
  onToggle: () => void;
  /**
   * Overrides the accessible name (aria-label). Defaults to the tooltip text
   * ("Expand"/"Collapse"). Pass a per-entry name (e.g. including the resource
   * URI) when several toggles sit in one list, so assistive tech can tell them
   * apart; the visible tooltip stays the plain verb.
   */
  ariaLabel?: string;
}

/**
 * Icon toggle for a per-entry expand/collapse control (Protocol, Network, and
 * Task cards). Uses the same expand/collapse-vertical icons as the list-level
 * ListToggle: collapsed shows the expand icon, expanded shows the collapse
 * icon. The tooltip stays "Expand"/"Collapse" (the same verb as the text button
 * it replaced); `aria-expanded` exposes the disclosure state and `ariaLabel`
 * can distinguish sibling toggles.
 */
export function ExpandToggle({
  expanded,
  onToggle,
  ariaLabel,
}: ExpandToggleProps) {
  const Icon = expanded ? RiCollapseVerticalLine : RiExpandVerticalLine;
  const label = expanded ? "Collapse" : "Expand";
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="md"
        aria-label={ariaLabel ?? label}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <Icon size={16} />
      </ActionIcon>
    </Tooltip>
  );
}
