import { ActionIcon, Tooltip } from "@mantine/core";
import { RiExpandVerticalLine, RiCollapseVerticalLine } from "react-icons/ri";

export interface ListToggleProps {
  compact: boolean;
  onToggle: () => void;
  variant?: "default" | "subtle";
}

const SubtleActionIcon = ActionIcon.withProps({
  variant: "subtle",
  color: "gray",
  size: "md",
});

// `size={36}` matches the header's theme / client-settings ActionIcons so the
// toolbar's toggle reads as the same size icon button.
const ToolbarActionIcon = ActionIcon.withProps({
  variant: "subtle",
  size: 36,
});

export function ListToggle({
  compact,
  onToggle,
  variant = "default",
}: ListToggleProps) {
  const Icon = compact ? RiExpandVerticalLine : RiCollapseVerticalLine;
  const label = compact ? "Expand all" : "Collapse all";

  if (variant === "subtle") {
    return (
      <Tooltip label={label}>
        <SubtleActionIcon aria-label={label} onClick={onToggle}>
          <Icon size={16} />
        </SubtleActionIcon>
      </Tooltip>
    );
  }

  return (
    <Tooltip label={label}>
      <ToolbarActionIcon aria-label={label} onClick={onToggle}>
        <Icon size={20} />
      </ToolbarActionIcon>
    </Tooltip>
  );
}
