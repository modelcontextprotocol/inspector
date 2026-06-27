import { Select } from "@mantine/core";
import { TbSortAscending2, TbSortDescending2 } from "react-icons/tb";

export type SortDirection = "oldest-first" | "newest-first";

export interface SortToggleProps {
  value: SortDirection;
  onChange: (next: SortDirection) => void;
  "aria-label"?: string;
}

const OPTIONS: { value: SortDirection; label: string }[] = [
  { value: "newest-first", label: "Newest First" },
  { value: "oldest-first", label: "Oldest First" },
];

function isSortDirection(value: string | null): value is SortDirection {
  return value === "oldest-first" || value === "newest-first";
}

export function SortToggle({
  value,
  onChange,
  "aria-label": ariaLabel = "Sort direction",
}: SortToggleProps) {
  const Icon = value === "newest-first" ? TbSortDescending2 : TbSortAscending2;
  return (
    <Select
      size="sm"
      w={150}
      data={OPTIONS}
      value={value}
      onChange={(next) => {
        // The guard's false arm is unreachable through the UI: Mantine's `data`
        // only holds the two valid SortDirection values and allowDeselect={false}
        // prevents a null deselect, so isSortDirection() is always true here.
        /* v8 ignore next */
        if (isSortDirection(next)) onChange(next);
      }}
      allowDeselect={false}
      withCheckIcon={false}
      rightSection={<Icon size={16} />}
      aria-label={ariaLabel}
    />
  );
}
