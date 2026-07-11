import { ActionIcon, Tooltip } from "@mantine/core";
import { RiExpandVerticalLine, RiCollapseVerticalLine } from "react-icons/ri";

export interface ListToggleProps {
  compact: boolean;
  onToggle: () => void;
  variant?: "default" | "subtle";
}

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
        <ActionIcon
          variant="subtle"
          color="gray"
          size="md"
          aria-label={label}
          onClick={onToggle}
        >
          <Icon size={16} />
        </ActionIcon>
      </Tooltip>
    );
  }

  // `size={36}` matches the header's theme / client-settings ActionIcons so the
  // toolbar's toggle reads as the same size icon button.
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
