import { ActionIcon } from "@mantine/core";
import { TbLayoutSidebarRightExpand } from "react-icons/tb";

export interface PinColumnButtonProps {
  /** Pin this screen into the monitoring column to the right. */
  onPin: () => void;
  /** Accessible label. Defaults to "Pin as column" (its monitor-screen use). */
  label?: string;
}

/**
 * Toolbar button that opens the resizable monitoring column on the right of the
 * InspectorView (#1616). On a monitor screen (Logs / Protocol / Network) it pins
 * that screen in as a column; on the server list it just opens the column (a
 * different `label`). Distinct from `PinToggle` (which pins individual history
 * entries) — this one opens a side column, so it uses a right-sidebar glyph.
 * `size={36}` matches the header's theme / client-settings ActionIcons and the
 * toolbar's `ListToggle`, so all these icon buttons share one width.
 */
export function PinColumnButton({
  onPin,
  label = "Pin as column",
}: PinColumnButtonProps) {
  return (
    <ActionIcon variant="subtle" size={36} aria-label={label} onClick={onPin}>
      <TbLayoutSidebarRightExpand size={20} />
    </ActionIcon>
  );
}
