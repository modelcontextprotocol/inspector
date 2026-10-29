import { Button, Group, Select, Stack, TextInput, Title } from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { TaskStatus } from "@modelcontextprotocol/client";

// h2 under the page's visually hidden h1 (#2827), sized as the h4 it was so
// the look is unchanged; sections below it are h3 (axe `heading-order`).
const PanelHeading = Title.withProps({ order: 2, size: "h4" });

// h3: a section under this screen's h2 panel heading (#2827), sized as the h5
// it was so the look is unchanged.
const SubHeading = Title.withProps({ order: 3, size: "h5" });

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

// h3 (not h6) to sit one level below the screen's h2 heading (#2827; avoids
// an axe `heading-order` skip); `size="h6"` preserves the visual size.
const FilterTitle = Title.withProps({
  order: 3,
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
        <PanelHeading>Tasks</PanelHeading>
        <ToolbarButton onClick={onRefresh}>Refresh</ToolbarButton>
      </HeaderRow>
      <SubHeading>Search</SubHeading>
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
