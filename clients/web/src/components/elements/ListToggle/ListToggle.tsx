import { ActionIcon, Button } from "@mantine/core";
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

  if (variant === "subtle") {
    return (
      <ActionIcon variant="subtle" color="gray" size="md" onClick={onToggle}>
        <Icon size={16} />
      </ActionIcon>
    );
  }

  return (
    <Button size="sm" onClick={onToggle}>
      <Icon size={20} />
    </Button>
  );
}
