import { ActionIcon, Button } from "@mantine/core";
import { TbSortAscending2, TbSortDescending2 } from "react-icons/tb";

export type SortDirection = "oldest-first" | "newest-first";

export interface SortToggleProps {
  value: SortDirection;
  onChange: (next: SortDirection) => void;
  variant?: "default" | "subtle";
  "aria-label"?: string;
}

export function SortToggle({
  value,
  onChange,
  variant = "default",
  "aria-label": ariaLabel = "Sort direction",
}: SortToggleProps) {
  const Icon =
    value === "newest-first" ? TbSortDescending2 : TbSortAscending2;
  const handleClick = () =>
    onChange(value === "newest-first" ? "oldest-first" : "newest-first");

  if (variant === "subtle") {
    return (
      <ActionIcon
        variant="subtle"
        color="gray"
        size="md"
        aria-label={ariaLabel}
        onClick={handleClick}
      >
        <Icon size={16} />
      </ActionIcon>
    );
  }

  return (
    <Button
      size="sm"
      variant="subtle"
      aria-label={ariaLabel}
      onClick={handleClick}
    >
      <Icon size={20} />
    </Button>
  );
}
