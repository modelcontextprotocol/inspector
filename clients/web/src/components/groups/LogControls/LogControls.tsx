import {
  Button,
  Checkbox,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
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

const LEVEL_COLORS: Record<string, { c: string; fw?: number }> = {
  debug: { c: "dimmed" },
  info: { c: "blue" },
  notice: { c: "teal" },
  warning: { c: "yellow" },
  error: { c: "red" },
  critical: { c: "red", fw: 700 },
  alert: { c: "red", fw: 700 },
  emergency: { c: "red", fw: 900 },
};

const ToolbarButton = Button.withProps({
  variant: "light",
  size: "sm",
});

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
  onClear: () => void;
  onExport: () => void;
}

export function LogControls({
  currentLevel,
  filterText,
  visibleLevels,
  onSetLevel,
  onFilterChange,
  onToggleLevel,
  onToggleAllLevels,
  onClear,
  onExport,
}: LogControlsProps) {
  return (
    <Stack gap="md">
      <Title order={4}>Logging</Title>

      <Title order={5}>Active Level</Title>
      <Group wrap="nowrap">
        <Select
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
      {LOG_LEVELS.map((level) => {
        const style = LEVEL_COLORS[level];
        return (
          <Checkbox
            key={level}
            checked={!!visibleLevels[level]}
            onChange={(e) => onToggleLevel(level, e.currentTarget.checked)}
            label={
              <Text c={style.c} fw={style.fw}>
                {level}
              </Text>
            }
          />
        );
      })}

      <Group>
        <ToolbarButton onClick={onClear}>Clear</ToolbarButton>
        <ToolbarButton onClick={onExport}>Export</ToolbarButton>
      </Group>
    </Stack>
  );
}
