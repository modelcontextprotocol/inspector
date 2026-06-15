import { Button, Group, Select, Stack, TextInput, Title } from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { FilterToggleButton } from "../../elements/FilterToggleButton/FilterToggleButton";

const LOG_LEVELS: LoggingLevel[] = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
];

const LEVEL_COLORS: Record<LoggingLevel, { c: string }> = {
  debug: { c: "dimmed" },
  info: { c: "blue" },
  notice: { c: "teal" },
  warning: { c: "yellow" },
  error: { c: "red" },
  critical: { c: "red" },
  alert: { c: "red" },
  emergency: { c: "red" },
};

const SubtleButton = Button.withProps({
  variant: "subtle",
  size: "xs",
});

export interface LogControlsProps {
  currentLevel: LoggingLevel;
  filterText: string;
  visibleLevels: Record<LoggingLevel, boolean>;
  onSetLevel: (level: LoggingLevel) => void;
  onFilterChange: (text: string) => void;
  onToggleLevel: (level: LoggingLevel, visible: boolean) => void;
  onToggleAllLevels: () => void;
}

export function LogControls({
  currentLevel,
  filterText,
  visibleLevels,
  onSetLevel,
  onFilterChange,
  onToggleLevel,
  onToggleAllLevels,
}: LogControlsProps) {
  return (
    <Stack gap="md">
      <Title order={4}>Logging</Title>

      <TextInput
        placeholder="Search..."
        value={filterText}
        onChange={(e) => onFilterChange(e.currentTarget.value)}
        rightSectionPointerEvents="auto"
        rightSection={
          filterText ? <ClearButton onClick={() => onFilterChange("")} /> : null
        }
      />

      <Title order={5}>Set Active Level</Title>
      <Group wrap="nowrap">
        <Select
          flex={1}
          data={LOG_LEVELS.map((level) => ({ value: level, label: level }))}
          value={currentLevel}
          onChange={(value) => {
            if (value && LOG_LEVELS.includes(value as LoggingLevel)) {
              onSetLevel(value as LoggingLevel);
            }
          }}
        />
        <Button size="sm" onClick={() => onSetLevel(currentLevel)}>
          Set
        </Button>
      </Group>

      <Group justify="space-between">
        <Title order={5}>Filter by Level</Title>
        <SubtleButton onClick={onToggleAllLevels}>
          {Object.values(visibleLevels).every(Boolean)
            ? "Deselect All"
            : "Select All"}
        </SubtleButton>
      </Group>
      <Stack gap="xs">
        {LOG_LEVELS.map((level) => (
          <FilterToggleButton
            key={level}
            label={level}
            color={LEVEL_COLORS[level].c}
            active={visibleLevels[level]}
            onToggle={(visible) => onToggleLevel(level, visible)}
          />
        ))}
      </Stack>
    </Stack>
  );
}
