import { Select, Stack, TextInput, Title } from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type {
  MessageMethod,
  MessageOrigin,
} from "@inspector/core/mcp/types.js";
import { MessageDirectionFilter } from "../MessageDirectionFilter/MessageDirectionFilter";

const SearchInput = TextInput.withProps({
  placeholder: "Search...",
  rightSectionPointerEvents: "auto",
});

// h5 (not h6) so it sits one level below the screen's h4 heading — avoids an axe
// `heading-order` skip; `size="h6"` keeps the small visual size.
const MethodFilterTitle = Title.withProps({
  order: 5,
  size: "h6",
});

const MethodSelect = Select.withProps({
  placeholder: "All methods",
  clearable: true,
});

export interface ProtocolControlsProps {
  searchText: string;
  methodFilter?: MessageMethod;
  availableMethods: MessageMethod[];
  visibleDirections: Record<MessageOrigin, boolean>;
  onSearchChange: (text: string) => void;
  onMethodFilterChange: (method: MessageMethod | undefined) => void;
  onToggleDirection: (direction: MessageOrigin, visible: boolean) => void;
  onToggleAllDirections: () => void;
}

export function ProtocolControls({
  searchText,
  methodFilter,
  availableMethods,
  visibleDirections,
  onSearchChange,
  onMethodFilterChange,
  onToggleDirection,
  onToggleAllDirections,
}: ProtocolControlsProps) {
  return (
    <Stack gap="md">
      <Title order={4}>Protocol</Title>
      <SearchInput
        value={searchText}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
        rightSection={
          searchText ? <ClearButton onClick={() => onSearchChange("")} /> : null
        }
      />

      <MethodFilterTitle>Filter by Method</MethodFilterTitle>
      <MethodSelect
        data={availableMethods}
        value={methodFilter ?? null}
        onChange={(value) =>
          onMethodFilterChange((value as MessageMethod | null) ?? undefined)
        }
      />

      <MessageDirectionFilter
        visibleDirections={visibleDirections}
        onToggleDirection={onToggleDirection}
        onToggleAllDirections={onToggleAllDirections}
      />
    </Stack>
  );
}
