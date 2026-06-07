import {
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import type {
  MessageMethod,
  MessageOrigin,
} from "@inspector/core/mcp/types.js";

const SubtleButton = Button.withProps({
  variant: "subtle",
  size: "xs",
});

// The two message directions, in display order. Label + color mirror the
// MessageDirectionBadge: outgoing (client → server) is green, incoming
// (client ← server) is violet.
const MESSAGE_DIRECTIONS: {
  origin: MessageOrigin;
  label: string;
  color: string;
}[] = [
  { origin: "client", label: "client → server", color: "green" },
  { origin: "server", label: "client ← server", color: "violet" },
];

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

      <Group justify="space-between">
        <Title order={6}>Filter by Message Direction</Title>
        <SubtleButton onClick={onToggleAllDirections}>
          {Object.values(visibleDirections).every(Boolean)
            ? "Deselect All"
            : "Select All"}
        </SubtleButton>
      </Group>
      <Stack gap="xs">
        {MESSAGE_DIRECTIONS.map(({ origin, label, color }) => {
          const active = visibleDirections[origin];
          return (
            <UnstyledButton
              key={origin}
              w="100%"
              p="sm"
              variant="listItem"
              bg={active ? "var(--mantine-primary-color-light)" : undefined}
              onClick={() => onToggleDirection(origin, !active)}
            >
              <Text c={color} ta="center" fw={500}>
                {label}
              </Text>
            </UnstyledButton>
          );
        })}
      </Stack>
    </Stack>
  );
}
