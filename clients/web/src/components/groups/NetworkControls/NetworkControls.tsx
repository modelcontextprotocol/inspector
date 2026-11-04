import { Button, Group, Stack, TextInput, Title } from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { FetchRequestCategory } from "@inspector/core/mcp/types.js";
import { FilterToggleButton } from "../../elements/FilterToggleButton/FilterToggleButton";

// h2 under the page's visually hidden h1 (#2827), sized as the h4 it was so
// the look is unchanged; sections below it are h3 (axe `heading-order`).
const PanelHeading = Title.withProps({ order: 2, size: "h4" });

// h3: a section under this screen's h2 panel heading (#2827), sized as the h5
// it was so the look is unchanged.
const SubHeading = Title.withProps({ order: 3, size: "h5" });

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
      <PanelHeading>Network</PanelHeading>

      <TextInput
        placeholder="Search..."
        value={filterText}
        onChange={(e) => onFilterChange(e.currentTarget.value)}
        rightSectionPointerEvents="auto"
        rightSection={
          filterText ? <ClearButton onClick={() => onFilterChange("")} /> : null
        }
      />

      <Group justify="space-between">
        <SubHeading>Filter by Category</SubHeading>
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
