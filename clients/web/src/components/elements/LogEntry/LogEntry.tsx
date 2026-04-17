import { Group, Text } from "@mantine/core";
import type {
  LoggingLevel,
  LoggingMessageNotification,
} from "@modelcontextprotocol/sdk/types.js";
import { LogLevelBadge } from "../LogLevelBadge/LogLevelBadge";

export interface LogEntryData {
  receivedAt: Date;
  params: LoggingMessageNotification["params"];
}

export interface LogEntryProps {
  entry: LogEntryData;
}

const levelMessageColor: Record<LoggingLevel, string | undefined> = {
  debug: "dimmed",
  info: "blue",
  notice: undefined,
  warning: "yellow",
  error: "red",
  critical: "red",
  alert: "red",
  emergency: "red",
};

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString();
}

function formatLogger(logger: string): string {
  return `[${logger}]`;
}

function formatData(data: unknown): string {
  if (data === undefined || data === null) return "";
  if (typeof data === "string") return data;
  return JSON.stringify(data);
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

export function LogEntry({ entry }: LogEntryProps) {
  const { receivedAt, params } = entry;
  const message = formatData(params.data);

  return (
    <Group gap="sm" wrap="nowrap">
      <TimestampText>{formatTimestamp(receivedAt)}</TimestampText>
      <LogLevelBadge level={params.level} />
      {params.logger && <LoggerText>{formatLogger(params.logger)}</LoggerText>}
      <Text size="sm" ff="monospace" c={levelMessageColor[params.level]}>
        {message}
      </Text>
    </Group>
  );
}
