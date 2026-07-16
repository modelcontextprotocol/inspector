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
      <Group flex={1} justify={"space-between"}>
        <Title order={4}>Tasks</Title>
        <ToolbarButton onClick={onRefresh}>Refresh</ToolbarButton>
      </Group>
      <Title order={5}>Search</Title>
      <TextInput
        placeholder="Search..."
        value={searchText}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
        rightSectionPointerEvents="auto"
        rightSection={
          searchText ? <ClearButton onClick={() => onSearchChange("")} /> : null
        }
      />

      {/* h5 (not h6) to sit one level below the screen's h4 heading (avoids an
          axe `heading-order` skip); `size="h6"` preserves the visual size. */}
      <Title order={5} size="h6">
        Filter by Status
      </Title>
      <Select
        placeholder="All statuses"
        data={STATUS_OPTIONS}
        value={statusFilter ?? null}
        onChange={(value) =>
          onStatusFilterChange(
            value && STATUS_OPTIONS.includes(value as TaskStatus)
              ? (value as TaskStatus)
              : undefined,
          )
        }
        clearable
      />
    </Stack>
  );
}
