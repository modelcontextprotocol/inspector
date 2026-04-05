import { Select, Stack, TextInput, Title } from "@mantine/core";

const METHOD_OPTIONS = [
  "tools/call",
  "tools/list",
  "resources/read",
  "resources/list",
  "prompts/get",
  "prompts/list",
  "sampling/createMessage",
  "elicitation/create",
];

export interface HistoryControlsProps {
  searchText: string;
  methodFilter?: string;
  onSearchChange: (text: string) => void;
  onMethodFilterChange: (method: string) => void;
}

export function HistoryControls({
  searchText,
  methodFilter,
  onSearchChange,
  onMethodFilterChange,
}: HistoryControlsProps) {
  return (
    <Stack gap="md">
      <Title order={4}>History</Title>
      <TextInput
        placeholder="Search..."
        value={searchText}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
      />

      <Title order={6}>Filter by Method</Title>
      <Select
        placeholder="All methods"
        data={METHOD_OPTIONS}
        value={methodFilter}
        onChange={(value) => onMethodFilterChange(value ?? "")}
        clearable
      />
    </Stack>
  );
}
