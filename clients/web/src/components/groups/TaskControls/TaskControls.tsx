import { Button, Group, Select, Stack, TextInput, Title } from "@mantine/core";
import type { TaskStatus } from "../TaskCard/TaskCard";

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
  statusFilter?: string;
  onSearchChange: (text: string) => void;
  onStatusFilterChange: (status: string) => void;
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
      />

      <Title order={6}>Filter by Status</Title>
      <Select
        placeholder="All statuses"
        data={STATUS_OPTIONS}
        value={statusFilter ?? null}
        onChange={(value) => onStatusFilterChange(value ?? "")}
        clearable
      />
    </Stack>
  );
}
