import { ActionIcon } from "@mantine/core";
import { TbLayoutSidebarRightExpand } from "react-icons/tb";

export interface PinColumnButtonProps {
  /** Pin this screen into the monitoring column to the right. */
  onPin: () => void;
}

/**
 * Toolbar icon that pins the owning monitor screen (Logs / History / Network)
 * into the resizable column on the right of the InspectorView (#1616). Distinct
 * from `PinToggle` (which pins individual history entries) — this one opens a
 * side column, so it uses a right-sidebar glyph and an "as column" label.
 */
export function PinColumnButton({ onPin }: PinColumnButtonProps) {
  return (
    <ActionIcon
      variant="default"
      size="lg"
      aria-label="Pin as column"
      onClick={onPin}
    >
      <TbLayoutSidebarRightExpand size={18} />
    </ActionIcon>
  );
}
