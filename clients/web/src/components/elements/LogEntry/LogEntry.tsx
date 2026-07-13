import { Group, Stack, Text } from "@mantine/core";
import type {
  LoggingLevel,
  LoggingMessageNotification,
} from "@modelcontextprotocol/sdk/types.js";
import { LogLevelBadge } from "../LogLevelBadge/LogLevelBadge";
import { accessibleTextColor } from "../accessibleTextColor";

export interface LogEntryData {
  receivedAt: Date;
  params: LoggingMessageNotification["params"];
}

export interface LogEntryProps {
  entry: LogEntryData;
  /**
   * Compact two-line layout for the narrow monitoring sidebar (#1661): the
   * timestamp, level, and logger sit on the first line and the message wraps
   * onto the line below, so a long message isn't clipped by the column width.
   * The default (false) is the single-line row used on the full Logs screen.
   */
  compact?: boolean;
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

// Single-line message (full Logs screen): sits inline with the meta on one row.
const MessageText = Text.withProps({
  size: "sm",
  ff: "monospace",
});

// Compact message (monitoring sidebar): wraps over-long lines within the narrow
// column via the `consoleLine` variant instead of overflowing its width.
const CompactMessageText = Text.withProps({
  size: "sm",
  ff: "monospace",
  variant: "consoleLine",
});

// The compact meta row: timestamp + level + logger on one line above the
// message. `wrap: nowrap` keeps them on a single line; the message wraps below.
const MetaRow = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
  align: "center",
});

export function LogEntry({ entry, compact = false }: LogEntryProps) {
  const { receivedAt, params } = entry;
  const message = formatData(params.data);
  const logger = params.logger ? (
    <LoggerText>{formatLogger(params.logger)}</LoggerText>
  ) : null;

  if (compact) {
    return (
      <Stack gap={2}>
        <MetaRow>
          <TimestampText>{formatTimestamp(receivedAt)}</TimestampText>
          <LogLevelBadge level={params.level} />
          {logger}
        </MetaRow>
        <CompactMessageText
          c={accessibleTextColor(levelMessageColor[params.level])}
        >
          {message}
        </CompactMessageText>
      </Stack>
    );
  }

  return (
    <Group gap="sm" wrap="nowrap">
      <TimestampText>{formatTimestamp(receivedAt)}</TimestampText>
      <LogLevelBadge level={params.level} />
      {logger}
      <MessageText c={accessibleTextColor(levelMessageColor[params.level])}>
        {message}
      </MessageText>
    </Group>
  );
}
