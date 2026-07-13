import { Select, Stack, TextInput, Title } from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type {
  MessageMethod,
  MessageOrigin,
} from "@inspector/core/mcp/types.js";
import { MessageDirectionFilter } from "../MessageDirectionFilter/MessageDirectionFilter";

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
      <TextInput
        placeholder="Search..."
        value={searchText}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
        rightSectionPointerEvents="auto"
        rightSection={
          searchText ? <ClearButton onClick={() => onSearchChange("")} /> : null
        }
      />

      {/* h5 (not h6) so it sits one level below the screen's h4 heading — avoids
          an axe `heading-order` skip; `size="h6"` keeps the small visual size. */}
      <Title order={5} size="h6">
        Filter by Method
      </Title>
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
