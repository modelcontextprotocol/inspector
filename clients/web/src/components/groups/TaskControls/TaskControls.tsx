import { Button, Group, Select, Stack, TextInput, Title } from "@mantine/core";
import type { TaskStatus } from "../TaskCard/TaskCard";

const STATUS_OPTIONS: TaskStatus[] = [
  "waiting",
  "running",
  "completed",
  "failed",
  "cancelled",
];

const ToolbarButton = Button.withProps({
  variant: "light",
  size: "sm",
});

export interface TaskControlsProps {
  searchText: string;
  statusFilter?: string;
  onSearchChange: (text: string) => void;
  onStatusFilterChange: (status: string) => void;
  onRefresh: () => void;
  onClearHistory: () => void;
}

export function TaskControls({
  searchText,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
  onRefresh,
  onClearHistory,
}: TaskControlsProps) {
  return (
    <Stack gap="md">
      <Title order={4}>Tasks</Title>

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
        value={statusFilter}
        onChange={(value) => onStatusFilterChange(value ?? "")}
        clearable
      />

      <Group>
        <ToolbarButton onClick={onRefresh}>Refresh</ToolbarButton>
        <ToolbarButton onClick={onClearHistory}>Clear History</ToolbarButton>
      </Group>
    </Stack>
  );
}
