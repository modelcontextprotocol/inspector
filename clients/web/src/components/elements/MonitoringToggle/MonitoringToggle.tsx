import { ActionIcon, Tooltip } from "@mantine/core";
import {
  TbLayoutSidebarRightExpand,
  TbLayoutSidebarRightCollapse,
} from "react-icons/tb";

export interface MonitoringToggleProps {
  /** Whether the monitoring sidebar is currently open. */
  open: boolean;
  /** Open the sidebar when closed, close it when open. */
  onToggle: () => void;
}

// `size={36}` matches the header's theme / client-settings ActionIcons.
const MonitoringActionIcon = ActionIcon.withProps({
  variant: "subtle",
  size: 36,
});

/**
 * The single header affordance for the monitoring sidebar (#1661). It replaces
 * the per-screen pin buttons, the server-list open-sidebar button, and the
 * sidebar's own close button — one toggle, placed in the header to the right of
 * the theme icon, that opens or closes the sidebar on demand. The glyph and
 * label reflect the current state (expand when closed, collapse when open). The
 * caller only mounts it when the sidebar is available (connected, or a failed
 * connect attempt, on a wide viewport), so it never appears with nothing to
 * toggle.
 */
export function MonitoringToggle({ open, onToggle }: MonitoringToggleProps) {
  const Icon = open ? TbLayoutSidebarRightCollapse : TbLayoutSidebarRightExpand;
  const label = open ? "Close monitoring sidebar" : "Open monitoring sidebar";

  return (
    <Tooltip label={label}>
      <MonitoringActionIcon aria-label={label} onClick={onToggle}>
        <Icon size={20} />
      </MonitoringActionIcon>
    </Tooltip>
  );
}
