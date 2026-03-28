import { Badge, Group, Text } from "@mantine/core";

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

const levelBadgeColor: Record<LogLevel, string> = {
  debug: "gray",
  info: "blue",
  notice: "teal",
  warning: "yellow",
  error: "red",
  critical: "red",
  alert: "red",
  emergency: "red",
};

const levelBadgeVariant: Record<LogLevel, string> = {
  debug: "light",
  info: "light",
  notice: "light",
  warning: "light",
  error: "light",
  critical: "filled",
  alert: "filled",
  emergency: "filled",
};

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

function isBoldLevel(level: LogLevel): boolean {
  return level === "alert" || level === "emergency";
}

function getBoldWeight(level: LogLevel): number | undefined {
  return isBoldLevel(level) ? 700 : undefined;
}

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
  c: "dimmed",
});

export function LogEntry({ timestamp, level, message, logger }: LogEntryProps) {
  return (
    <Group gap="sm" wrap="nowrap">
      <TimestampText>{timestamp}</TimestampText>
      <Badge
        color={levelBadgeColor[level]}
        variant={levelBadgeVariant[level]}
        fw={getBoldWeight(level)}
      >
        {level}
      </Badge>
      {logger && <LoggerText>{formatLogger(logger)}</LoggerText>}
      <Text size="sm" c={levelMessageColor[level]}>
        {message}
      </Text>
    </Group>
  );
}
