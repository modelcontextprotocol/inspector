import { Group, Stack, Text } from "@mantine/core";
import type {
  LoggingLevel,
  LoggingMessageNotification,
} from "@modelcontextprotocol/client";
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
   * timestamp, level, and logger sit on the first line (a long logger wraps
   * below the level) and the message wraps onto the line below, so neither is
   * clipped by the column width.
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

// The logger name in the compact (sidebar) row: breaks inside a long name via
// the `consoleLine` variant instead of squeezing the level badge (#2675).
const CompactLoggerText = Text.withProps({
  size: "xs",
  ff: "monospace",
  c: "dimmed",
  variant: "consoleLine",
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

// The compact meta row: timestamp + level + logger above the message. It
// wraps, so a logger name too long for the line moves below the level badge
// rather than squeezing it until its label clips (#2675).
const MetaRow = Group.withProps({
  gap: "xs",
  wrap: "wrap",
  align: "center",
});

// The single-line row (full Logs screen): meta + message on one row.
const LogRow = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
});

export function LogEntry({ entry, compact = false }: LogEntryProps) {
  const { receivedAt, params } = entry;
  const message = formatData(params.data);

  if (compact) {
    return (
      <Stack gap={2}>
        <MetaRow>
          <TimestampText>{formatTimestamp(receivedAt)}</TimestampText>
          <LogLevelBadge level={params.level} />
          {params.logger && (
            <CompactLoggerText>{formatLogger(params.logger)}</CompactLoggerText>
          )}
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
    <LogRow>
      <TimestampText>{formatTimestamp(receivedAt)}</TimestampText>
      <LogLevelBadge level={params.level} />
      {params.logger && <LoggerText>{formatLogger(params.logger)}</LoggerText>}
      <MessageText c={accessibleTextColor(levelMessageColor[params.level])}>
        {message}
      </MessageText>
    </LogRow>
  );
}
