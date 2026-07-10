import { Button } from "@mantine/core";
import { TbLayoutSidebarRightExpand } from "react-icons/tb";

export interface PinColumnButtonProps {
  /** Pin this screen into the monitoring column to the right. */
  onPin: () => void;
}

/**
 * Toolbar button that pins the owning monitor screen (Logs / Protocol / Network)
 * into the resizable column on the right of the InspectorView (#1616). Distinct
 * from `PinToggle` (which pins individual history entries) — this one opens a
 * side column, so it uses a right-sidebar glyph and an "as column" label. Styled
 * to match the panel's expand/collapse `ListToggle` (subtle icon button).
 */
export function PinColumnButton({ onPin }: PinColumnButtonProps) {
  return (
    <Button
      size="sm"
      variant="subtle"
      aria-label="Pin as column"
      onClick={onPin}
    >
      <TbLayoutSidebarRightExpand size={20} />
    </Button>
  );
}
