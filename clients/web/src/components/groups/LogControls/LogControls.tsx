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
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";

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
      />

      <Title order={5}>Set Active Level</Title>
      <Group wrap="nowrap">
        <Select
          flex={1}
          data={LOG_LEVELS.map((level) => ({ value: level, label: level }))}
          value={currentLevel}
          onChange={(value) => {
            if (value) onSetLevel(value as LoggingLevel);
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
        {LOG_LEVELS.map((level) => {
          const style = LEVEL_COLORS[level];
          const active = visibleLevels[level];
          return (
            <UnstyledButton
              key={level}
              w="100%"
              p="sm"
              variant="listItem"
              bg={active ? "var(--mantine-primary-color-light)" : undefined}
              onClick={() => onToggleLevel(level, !active)}
            >
              <Text c={style.c} ta="center" fw={500}>
                {level}
              </Text>
            </UnstyledButton>
          );
        })}
      </Stack>
    </Stack>
  );
}
