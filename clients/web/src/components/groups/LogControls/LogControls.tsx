import {
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { LoggingLevel, ProtocolEra } from "@modelcontextprotocol/client";
import { FilterToggleButton } from "../../elements/FilterToggleButton/FilterToggleButton";
import { isModernEra } from "../../elements/EraBadge/eraUtils";

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

// Sentinel `Select` value for "don't opt in" on the modern per-request control.
// Not a valid `LoggingLevel`, so it can never collide with a real level.
const MODERN_OFF_VALUE = "__off__";

const SubtleButton = Button.withProps({
  variant: "subtle",
  size: "xs",
});

const HelpText = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
});

const LEVEL_OPTIONS = LOG_LEVELS.map((level) => ({
  value: level,
  label: level,
}));

export interface LogControlsProps {
  currentLevel: LoggingLevel;
  filterText: string;
  visibleLevels: Record<LoggingLevel, boolean>;
  onSetLevel: (level: LoggingLevel) => void;
  onFilterChange: (text: string) => void;
  onToggleLevel: (level: LoggingLevel, visible: boolean) => void;
  onToggleAllLevels: () => void;
  /**
   * Negotiated protocol era. On the modern era (2026-07-28) `logging/setLevel`
   * is gone; the level selector is replaced by the per-request opt-in control
   * below. Undefined / legacy keeps the session-scoped `Set` selector (#1629).
   */
  protocolEra?: ProtocolEra;
  /**
   * Modern-era per-request log level currently stamped on every request, or
   * `null` when not opted in (no logs). Only meaningful on the modern era.
   */
  modernLogLevel?: LoggingLevel | null;
  /** Set (or clear, with `null`) the modern per-request log level. */
  onSetModernLogLevel?: (level: LoggingLevel | null) => void;
}

// Legacy: session-scoped `logging/setLevel` — a level selector plus a "Set"
// button that sends the request. The value is optimistic (there's no echo).
const LegacyLevelControl = ({
  currentLevel,
  onSetLevel,
}: Pick<LogControlsProps, "currentLevel" | "onSetLevel">) => (
  <>
    <Title order={5}>Set Active Level</Title>
    <Group wrap="nowrap">
      <Select
        aria-label="Set Active Level"
        flex={1}
        data={LEVEL_OPTIONS}
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
  </>
);

// Modern: per-request opt-in via the `io.modelcontextprotocol/logLevel` `_meta`
// key. There is no session level and no `Set` — the chosen level is stamped on
// every subsequent request and takes effect immediately. "Off" stops opting in.
const ModernLevelControl = ({
  modernLogLevel,
  onSetModernLogLevel,
}: Pick<LogControlsProps, "modernLogLevel" | "onSetModernLogLevel">) => (
  <>
    <Title order={5}>Log Level per Request</Title>
    <HelpText>
      Modern servers only emit logs for requests that opt in. The level you
      choose is stamped on every request, and logs arrive on the originating
      request&apos;s stream. Choose Off to stop requesting logs.
    </HelpText>
    <Select
      aria-label="Log Level per Request"
      data={[
        { value: MODERN_OFF_VALUE, label: "Off (no logs)" },
        ...LEVEL_OPTIONS,
      ]}
      value={modernLogLevel ?? MODERN_OFF_VALUE}
      allowDeselect={false}
      onChange={(value) => {
        if (value === MODERN_OFF_VALUE) {
          onSetModernLogLevel?.(null);
        } else if (value && LOG_LEVELS.includes(value as LoggingLevel)) {
          onSetModernLogLevel?.(value as LoggingLevel);
        }
      }}
    />
  </>
);

export function LogControls({
  currentLevel,
  filterText,
  visibleLevels,
  onSetLevel,
  onFilterChange,
  onToggleLevel,
  onToggleAllLevels,
  protocolEra,
  modernLogLevel = null,
  onSetModernLogLevel,
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

      {isModernEra(protocolEra) ? (
        <ModernLevelControl
          modernLogLevel={modernLogLevel}
          onSetModernLogLevel={onSetModernLogLevel}
        />
      ) : (
        <LegacyLevelControl
          currentLevel={currentLevel}
          onSetLevel={onSetLevel}
        />
      )}

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
