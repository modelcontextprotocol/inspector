import { ActionIcon, Tooltip } from "@mantine/core";
import {
  TbLayoutSidebarRightExpand,
  TbLayoutSidebarRightCollapse,
} from "react-icons/tb";

export interface MonitoringToggleProps {
  /** Whether the monitoring sidebar is currently open. */
  open: boolean;
  /** Open the column when closed, close it when open. */
  onToggle: () => void;
}

/**
 * The single header affordance for the monitoring sidebar (#1661). It replaces
 * the per-screen "pin as column" buttons, the server-list open-sidebar button,
 * and the column's own close button — one toggle, placed in the header to the
 * right of the theme icon, that opens or closes the column on demand. The glyph
 * and label reflect the current state (expand when closed, collapse when open).
 * The caller only mounts it when the column is available (connected, or a failed
 * connect attempt, on a wide viewport), so it never appears with nothing to
 * toggle. `size={36}` matches the header's theme / client-settings ActionIcons.
 */
export function MonitoringToggle({ open, onToggle }: MonitoringToggleProps) {
  const Icon = open ? TbLayoutSidebarRightCollapse : TbLayoutSidebarRightExpand;
  const label = open ? "Close monitoring sidebar" : "Open monitoring sidebar";

  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="subtle"
        size={36}
        aria-label={label}
        onClick={onToggle}
      >
        <Icon size={20} />
      </ActionIcon>
    </Tooltip>
  );
}
