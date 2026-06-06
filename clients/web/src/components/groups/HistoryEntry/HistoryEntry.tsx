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
import { extractMethod, isReplayableHistoryMethod } from "../historyUtils.js";

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

function extractTarget(entry: MessageEntry): string | undefined {
  const msg = entry.message;
  if (!("params" in msg) || !msg.params) return undefined;
  const params = msg.params as Record<string, unknown>;
  if (typeof params.name === "string") return params.name;
  if (typeof params.uri === "string") return params.uri;
  return undefined;
}

// The pending → OK/Error lifecycle only applies to requests: messageLogState
// attaches a `response` to request entries by JSON-RPC id. A notification is
// fire-and-forget (no id, no response, ever) and an unmatched standalone
// response has none either — so those carry no request-style status ("none")
// and render no badge, rather than a misleading permanent "Pending".
function extractStatus(
  entry: MessageEntry,
): "success" | "error" | "pending" | "none" {
  if (entry.direction !== "request") return "none";
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
  const canReplay = isReplayableHistoryMethod(method);

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
            {status !== "none" && (
              <Badge color={statusColor(status)}>{statusLabel(status)}</Badge>
            )}
          </Group>
        </HeaderRow>

        <Group gap="xs">
          <SubtleButton onClick={onTogglePin}>
            {formatPinLabel(isPinned)}
          </SubtleButton>
          {canReplay && <SubtleButton onClick={onReplay}>Replay</SubtleButton>}
          <SubtleButton onClick={() => setIsExpanded((v) => !v)} ml="auto">
            {isExpanded ? "Collapse" : "Expand"}
          </SubtleButton>
        </Group>

        <Collapse in={isExpanded}>
          <Stack gap="sm">
            <Divider />
            {"params" in entry.message && entry.message.params && (
              <Stack gap="xs">
                <Text size="sm">Parameters:</Text>
                <ContentViewer
                  block={{
                    type: "text",
                    text: serializeMessage(entry.message.params),
                  }}
                  copyable
                />
              </Stack>
            )}
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
