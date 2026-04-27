import { Select, Stack, TextInput, Title } from "@mantine/core";
import type { RequestMethod } from "@inspector/core/mcp/types.js";

export interface HistoryControlsProps {
  searchText: string;
  methodFilter?: RequestMethod;
  availableMethods: RequestMethod[];
  onSearchChange: (text: string) => void;
  onMethodFilterChange: (method: RequestMethod | undefined) => void;
}

export function HistoryControls({
  searchText,
  methodFilter,
  availableMethods,
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
        data={availableMethods}
        value={methodFilter ?? null}
        onChange={(value) =>
          onMethodFilterChange((value as RequestMethod | null) ?? undefined)
        }
        clearable
      />
    </Stack>
  );
}
