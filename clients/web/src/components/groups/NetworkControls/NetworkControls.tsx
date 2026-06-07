import {
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import type {
  FetchRequestCategory,
  MessageOrigin,
} from "@inspector/core/mcp/types.js";
import { MessageDirectionFilter } from "../MessageDirectionFilter/MessageDirectionFilter";

const NETWORK_CATEGORIES: FetchRequestCategory[] = ["auth", "transport"];

const CATEGORY_COLORS: Record<FetchRequestCategory, string> = {
  auth: "violet",
  transport: "blue",
};

const SubtleButton = Button.withProps({
  variant: "subtle",
  size: "xs",
});

export interface NetworkControlsProps {
  filterText: string;
  visibleCategories: Record<FetchRequestCategory, boolean>;
  visibleDirections: Record<MessageOrigin, boolean>;
  onFilterChange: (text: string) => void;
  onToggleCategory: (category: FetchRequestCategory, visible: boolean) => void;
  onToggleAllCategories: () => void;
  onToggleDirection: (direction: MessageOrigin, visible: boolean) => void;
  onToggleAllDirections: () => void;
}

export function NetworkControls({
  filterText,
  visibleCategories,
  visibleDirections,
  onFilterChange,
  onToggleCategory,
  onToggleAllCategories,
  onToggleDirection,
  onToggleAllDirections,
}: NetworkControlsProps) {
  const allSelected = NETWORK_CATEGORIES.every((c) => visibleCategories[c]);
  return (
    <Stack gap="md">
      <Title order={4}>Network</Title>

      <TextInput
        placeholder="Search..."
        value={filterText}
        onChange={(e) => onFilterChange(e.currentTarget.value)}
      />

      <Group justify="space-between">
        <Title order={5}>Filter by Category</Title>
        <SubtleButton onClick={onToggleAllCategories}>
          {allSelected ? "Deselect All" : "Select All"}
        </SubtleButton>
      </Group>
      <Stack gap="xs">
        {NETWORK_CATEGORIES.map((category) => {
          const active = visibleCategories[category];
          return (
            <UnstyledButton
              key={category}
              w="100%"
              p="sm"
              variant="listItem"
              aria-pressed={active}
              bg={active ? "var(--mantine-primary-color-light)" : undefined}
              onClick={() => onToggleCategory(category, !active)}
            >
              <Text c={CATEGORY_COLORS[category]} ta="center" fw={500}>
                {category}
              </Text>
            </UnstyledButton>
          );
        })}
      </Stack>

      <MessageDirectionFilter
        visibleDirections={visibleDirections}
        onToggleDirection={onToggleDirection}
        onToggleAllDirections={onToggleAllDirections}
      />
    </Stack>
  );
}
