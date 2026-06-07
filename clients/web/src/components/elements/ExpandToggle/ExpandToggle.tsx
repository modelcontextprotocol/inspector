import { ActionIcon } from "@mantine/core";
import { LuArrowDownToLine, LuArrowUpFromLine } from "react-icons/lu";

export interface ExpandToggleProps {
  /** Whether the owning entry is currently expanded. */
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Icon toggle for a per-entry expand/collapse control (History, Network, and
 * Task cards). Collapsed shows a down-to-line arrow ("pull the details down" =
 * expand); expanded shows an up-from-line arrow ("push them back up" =
 * collapse). The aria-label stays "Expand"/"Collapse" so it reads the same as
 * the text button it replaces.
 */
export function ExpandToggle({ expanded, onToggle }: ExpandToggleProps) {
  const Icon = expanded ? LuArrowUpFromLine : LuArrowDownToLine;
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
