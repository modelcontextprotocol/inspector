import { Group, Text } from "@mantine/core";
import { LogLevelBadge } from "../LogLevelBadge/LogLevelBadge";

export type LogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

export interface LogEntryProps {
  timestamp: string;
  level: LogLevel;
  message: string;
  logger?: string;
}

const levelMessageColor: Record<LogLevel, string | undefined> = {
  debug: "dimmed",
  info: "blue",
  notice: undefined,
  warning: "yellow",
  error: "red",
  critical: "red",
  alert: "red",
  emergency: "red",
};

function formatLogger(logger: string): string {
  return `[${logger}]`;
}

const TimestampText = Text.withProps({
  size: "sm",
  ff: "monospace",
  c: "dimmed",
});

const LoggerText = Text.withProps({
  size: "xs",
  ff: "monospace",
  c: "dimmed",
});

export function LogEntry({ timestamp, level, message, logger }: LogEntryProps) {
  return (
    <Group gap="sm" wrap="nowrap">
      <TimestampText>{timestamp}</TimestampText>
      <LogLevelBadge level={level} />
      {logger && <LoggerText>{formatLogger(logger)}</LoggerText>}
      <Text size="sm" ff="monospace" c={levelMessageColor[level]}>
        {message}
      </Text>
    </Group>
  );
}
