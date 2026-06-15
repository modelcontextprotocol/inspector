import { Select, Stack, TextInput, Title } from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type {
  MessageMethod,
  MessageOrigin,
} from "@inspector/core/mcp/types.js";
import { MessageDirectionFilter } from "../MessageDirectionFilter/MessageDirectionFilter";

export interface HistoryControlsProps {
  searchText: string;
  methodFilter?: MessageMethod;
  availableMethods: MessageMethod[];
  visibleDirections: Record<MessageOrigin, boolean>;
  onSearchChange: (text: string) => void;
  onMethodFilterChange: (method: MessageMethod | undefined) => void;
  onToggleDirection: (direction: MessageOrigin, visible: boolean) => void;
  onToggleAllDirections: () => void;
}

export function HistoryControls({
  searchText,
  methodFilter,
  availableMethods,
  visibleDirections,
  onSearchChange,
  onMethodFilterChange,
  onToggleDirection,
  onToggleAllDirections,
}: HistoryControlsProps) {
  return (
    <Stack gap="md">
      <Title order={4}>History</Title>
      <TextInput
        placeholder="Search..."
        value={searchText}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
        rightSectionPointerEvents="auto"
        rightSection={
          searchText ? <ClearButton onClick={() => onSearchChange("")} /> : null
        }
      />

      <Title order={6}>Filter by Method</Title>
      <Select
        placeholder="All methods"
        data={availableMethods}
        value={methodFilter ?? null}
        onChange={(value) =>
          onMethodFilterChange((value as MessageMethod | null) ?? undefined)
        }
        clearable
      />

      <MessageDirectionFilter
        visibleDirections={visibleDirections}
        onToggleDirection={onToggleDirection}
        onToggleAllDirections={onToggleAllDirections}
      />
    </Stack>
  );
}
