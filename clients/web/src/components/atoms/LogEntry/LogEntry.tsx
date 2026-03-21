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

export function LogEntry({ timestamp, level, message, logger }: LogEntryProps) {
  return (
    <Group gap="sm" wrap="nowrap">
      <Text size="sm" ff="monospace" c="dimmed">
        {timestamp}
      </Text>
      <Badge
        color={levelBadgeColor[level]}
        variant={levelBadgeVariant[level]}
        fw={isBoldLevel(level) ? 700 : undefined}
      >
        {level}
      </Badge>
      {logger && (
        <Text size="xs" c="dimmed">
          [{logger}]
        </Text>
      )}
      <Text size="sm" c={levelMessageColor[level]}>
        {message}
      </Text>
    </Group>
  );
}
