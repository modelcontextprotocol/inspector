import {
  Button,
  CloseButton,
  Group,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import type { FetchRequestCategory } from "@inspector/core/mcp/types.js";
import { FilterToggleButton } from "../../elements/FilterToggleButton/FilterToggleButton";

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
  onFilterChange: (text: string) => void;
  onToggleCategory: (category: FetchRequestCategory, visible: boolean) => void;
  onToggleAllCategories: () => void;
}

export function NetworkControls({
  filterText,
  visibleCategories,
  onFilterChange,
  onToggleCategory,
  onToggleAllCategories,
}: NetworkControlsProps) {
  const allSelected = NETWORK_CATEGORIES.every((c) => visibleCategories[c]);
  return (
    <Stack gap="md">
      <Title order={4}>Network</Title>

      <TextInput
        placeholder="Search..."
        value={filterText}
        onChange={(e) => onFilterChange(e.currentTarget.value)}
        rightSectionPointerEvents="auto"
        rightSection={
          filterText ? (
            <CloseButton
              aria-label="Clear"
              onClick={() => onFilterChange("")}
            />
          ) : null
        }
      />

      <Group justify="space-between">
        <Title order={5}>Filter by Category</Title>
        <SubtleButton onClick={onToggleAllCategories}>
          {allSelected ? "Deselect All" : "Select All"}
        </SubtleButton>
      </Group>
      <Stack gap="xs">
        {NETWORK_CATEGORIES.map((category) => (
          <FilterToggleButton
            key={category}
            label={category}
            color={CATEGORY_COLORS[category]}
            active={visibleCategories[category]}
            onToggle={(visible) => onToggleCategory(category, visible)}
          />
        ))}
      </Stack>
    </Stack>
  );
}
