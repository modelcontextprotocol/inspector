import { Button, Group, Select, Stack, TextInput, Title } from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { TaskStatus } from "@modelcontextprotocol/client";

const STATUS_OPTIONS: TaskStatus[] = [
  "working",
  "input_required",
  "completed",
  "failed",
  "cancelled",
];

const ToolbarButton = Button.withProps({
  variant: "subtle",
  size: "sm",
});

const HeaderRow = Group.withProps({
  flex: 1,
  justify: "space-between",
});

const SearchInput = TextInput.withProps({
  placeholder: "Search...",
  rightSectionPointerEvents: "auto",
});

// h5 (not h6) to sit one level below the screen's h4 heading (avoids an
// axe `heading-order` skip); `size="h6"` preserves the visual size.
const FilterTitle = Title.withProps({
  order: 5,
  size: "h6",
});

const StatusSelect = Select.withProps({
  placeholder: "All statuses",
  clearable: true,
});

export interface TaskControlsProps {
  searchText: string;
  statusFilter?: TaskStatus;
  onSearchChange: (text: string) => void;
  onStatusFilterChange: (status: TaskStatus | undefined) => void;
  onRefresh: () => void;
}

export function TaskControls({
  searchText,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onRefresh,
}: TaskControlsProps) {
  return (
    <Stack gap="md">
      <HeaderRow>
        <Title order={4}>Tasks</Title>
        <ToolbarButton onClick={onRefresh}>Refresh</ToolbarButton>
      </HeaderRow>
      <Title order={5}>Search</Title>
      <SearchInput
        value={searchText}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
        rightSection={
          searchText ? <ClearButton onClick={() => onSearchChange("")} /> : null
        }
      />

      <FilterTitle>Filter by Status</FilterTitle>
      <StatusSelect
        data={STATUS_OPTIONS}
        value={statusFilter ?? null}
        onChange={(value) =>
          onStatusFilterChange(
            value && STATUS_OPTIONS.includes(value as TaskStatus)
              ? (value as TaskStatus)
              : undefined,
          )
        }
      />
    </Stack>
  );
}
