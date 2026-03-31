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

const LOG_LEVELS = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
] as const;

const LEVEL_COLORS: Record<string, { c: string }> = {
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
  currentLevel: string;
  filterText: string;
  visibleLevels: Record<string, boolean>;
  onSetLevel: (level: string) => void;
  onFilterChange: (text: string) => void;
  onToggleLevel: (level: string, visible: boolean) => void;
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

      <Title order={5}>Active Level</Title>
      <Group wrap="nowrap">
        <Select
          flex={1}
          data={LOG_LEVELS.map((level) => ({ value: level, label: level }))}
          value={currentLevel}
          onChange={(value) => {
            if (value) onSetLevel(value);
          }}
        />
        <Button size="sm" onClick={() => onSetLevel(currentLevel)}>
          Set
        </Button>
      </Group>

      <Title order={5}>Search</Title>
      <TextInput
        placeholder="Search logs..."
        value={filterText}
        onChange={(e) => onFilterChange(e.currentTarget.value)}
      />

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
          const active = !!visibleLevels[level];
          return (
            <UnstyledButton
              key={level}
              w="100%"
              p="sm"
              variant="listItem"
              bg={active ? "var(--mantine-primary-color-light)" : undefined}
              onClick={() => onToggleLevel(level, !active)}
            >
              <Text c={style.c} ta="center" fw={500}>{level}</Text>
            </UnstyledButton>
          );
        })}
      </Stack>
    </Stack>
  );
}
