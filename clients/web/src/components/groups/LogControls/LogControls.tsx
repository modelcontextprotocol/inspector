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

export interface LogControlsProps {
  currentLevel: string;
  filterText: string;
  visibleLevels: Record<string, boolean>;
  onSetLevel: (level: string) => void;
  onFilterChange: (text: string) => void;
  onToggleLevel: (level: string, visible: boolean) => void;
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
  onClear,
  onExport,
}: LogControlsProps) {
  return (
    <Stack gap="md">
      <Title order={5}>Log Level</Title>
      <Group>
        <Select
          data={LOG_LEVELS.map((level) => ({ value: level, label: level }))}
          value={currentLevel}
          onChange={(value) => {
            if (value) onSetLevel(value);
          }}
        />
        <Button size="sm" onClick={() => onSetLevel(currentLevel)}>
          Set Level
        </Button>
      </Group>

      <Title order={5}>Filter</Title>
      <TextInput
        placeholder="Search logs..."
        value={filterText}
        onChange={(e) => onFilterChange(e.currentTarget.value)}
      />

      <Title order={5}>Show Levels</Title>
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
