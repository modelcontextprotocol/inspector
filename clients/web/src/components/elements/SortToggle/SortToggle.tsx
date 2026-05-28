import { Select } from "@mantine/core";

export type SortDirection = "oldest-first" | "newest-first";

export interface SortToggleProps {
  value: SortDirection;
  onChange: (next: SortDirection) => void;
  "aria-label"?: string;
}

const OPTIONS: { value: SortDirection; label: string }[] = [
  { value: "newest-first", label: "Sort: Newest First" },
  { value: "oldest-first", label: "Sort: Oldest First" },
];

function isSortDirection(value: string | null): value is SortDirection {
  return value === "oldest-first" || value === "newest-first";
}

export function SortToggle({
  value,
  onChange,
  "aria-label": ariaLabel = "Sort direction",
}: SortToggleProps) {
  return (
    <Select
      size="sm"
      w={190}
      data={OPTIONS}
      value={value}
      onChange={(next) => {
        if (isSortDirection(next)) onChange(next);
      }}
      allowDeselect={false}
      withCheckIcon={false}
      aria-label={ariaLabel}
    />
  );
}
