import { Button } from "@mantine/core";
import { RiExpandVerticalLine, RiCollapseVerticalLine } from "react-icons/ri";

export interface ListToggleProps {
  compact: boolean;
  onToggle: () => void;
}

export function ListToggle({ compact, onToggle }: ListToggleProps) {
  const Icon = compact ? RiExpandVerticalLine : RiCollapseVerticalLine;

  return (
    <Button size="sm" onClick={onToggle}>
      <Icon size={20} />
    </Button>
  );
}
