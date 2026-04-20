import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Collapse,
  Divider,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import type { MessageEntry } from "../../../../../../core/mcp/types.js";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";

export interface HistoryEntryProps {
  entry: MessageEntry;
  isPinned: boolean;
  isListExpanded: boolean;
  onReplay: () => void;
  onTogglePin: () => void;
}

const EntryContainer = Card.withProps({
  withBorder: true,
  padding: "md",
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

const TimestampText = Text.withProps({
  size: "sm",
  c: "dimmed",
  ff: "monospace",
});

const TargetText = Text.withProps({
  size: "sm",
  fw: 500,
});

const DurationText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const SubtleButton = Button.withProps({
  variant: "subtle",
  size: "xs",
});

function formatDuration(ms: number): string {
  return `${ms}ms`;
}

function formatTimestamp(date: Date): string {
  return date.toISOString();
}

function formatPinLabel(isPinned: boolean): string {
  return isPinned ? "Unpin" : "Pin";
}

function extractMethod(entry: MessageEntry): string {
  if ("method" in entry.message) {
    return entry.message.method;
  }
  return "response";
}

function extractTarget(entry: MessageEntry): string | undefined {
  const msg = entry.message;
  if (!("params" in msg) || !msg.params) return undefined;
  const params = msg.params as Record<string, unknown>;
  if (typeof params.name === "string") return params.name;
  if (typeof params.uri === "string") return params.uri;
  return undefined;
}

function extractStatus(entry: MessageEntry): "success" | "error" | "pending" {
  if (!entry.response) return "pending";
  if ("error" in entry.response) return "error";
  return "success";
}

function statusColor(status: "success" | "error" | "pending"): string {
  if (status === "success") return "green";
  if (status === "error") return "red";
  return "gray";
}

function statusLabel(status: "success" | "error" | "pending"): string {
  if (status === "success") return "OK";
  if (status === "error") return "Error";
  return "Pending";
}

function serializeMessage(value: unknown): string {
  return JSON.stringify(value);
}

export function HistoryEntry({
  entry,
  isPinned,
  isListExpanded,
  onReplay,
  onTogglePin,
}: HistoryEntryProps) {
  const [isExpanded, setIsExpanded] = useState(isListExpanded);
  const method = extractMethod(entry);
  const target = extractTarget(entry);
  const status = extractStatus(entry);

  useEffect(() => {
    setIsExpanded(isListExpanded);
  }, [isListExpanded]);

  return (
    <EntryContainer>
      <Stack gap="sm">
        <HeaderRow>
          <Group gap="sm">
            <TimestampText>{formatTimestamp(entry.timestamp)}</TimestampText>
            <Badge color="dark">{method}</Badge>
            {target && <TargetText>{target}</TargetText>}
          </Group>
          <Group gap="sm">
            {entry.duration != null && (
              <DurationText>{formatDuration(entry.duration)}</DurationText>
            )}
            <Badge color={statusColor(status)}>{statusLabel(status)}</Badge>
          </Group>
        </HeaderRow>

        <Group gap="xs">
          <SubtleButton onClick={onReplay}>Replay</SubtleButton>
          <SubtleButton onClick={onTogglePin}>
            {formatPinLabel(isPinned)}
          </SubtleButton>
          <SubtleButton onClick={() => setIsExpanded((v) => !v)} ml="auto">
            {isExpanded ? "Collapse" : "Expand"}
          </SubtleButton>
        </Group>

        <Collapse in={isExpanded}>
          <Stack gap="sm">
            <Divider />
            <Stack gap="xs">
              <Text size="sm">Request:</Text>
              <ContentViewer
                block={{
                  type: "text",
                  text: serializeMessage(entry.message),
                }}
                copyable
              />
            </Stack>
            {entry.response && (
              <Stack gap="xs">
                <Text size="sm">Response:</Text>
                <ContentViewer
                  block={{
                    type: "text",
                    text: serializeMessage(entry.response),
                  }}
                  copyable
                />
              </Stack>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </EntryContainer>
  );
}
