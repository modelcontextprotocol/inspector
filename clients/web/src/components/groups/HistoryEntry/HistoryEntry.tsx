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
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";

export interface HistoryChildEntry {
  timestamp: string;
  method: string;
  target?: string;
  status: "success" | "error";
  durationMs: number;
}

export interface HistoryEntryProps {
  timestamp: string;
  method: string;
  target?: string;
  status: "success" | "error";
  durationMs: number;
  parameters?: Record<string, unknown>;
  response?: Record<string, unknown>;
  childEntries?: HistoryChildEntry[];
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

const ChildMethodBadge = Badge.withProps({
  color: "dark",
  size: "sm",
});

function formatDuration(ms: number): string {
  return `${ms}ms`;
}

function formatStatusLabel(status: "success" | "error"): string {
  return status === "success" ? "OK" : "Error";
}

function statusColor(status: "success" | "error"): string {
  return status === "success" ? "green" : "red";
}

function formatPinLabel(isPinned: boolean): string {
  return isPinned ? "Unpin" : "Pin";
}

function serializeJson(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export function HistoryEntry({
  timestamp,
  method,
  target,
  status,
  durationMs,
  parameters,
  response,
  childEntries,
  isPinned,
  isListExpanded,
  onReplay,
  onTogglePin,
}: HistoryEntryProps) {
  const [isExpanded, setIsExpanded] = useState(isListExpanded);

  useEffect(() => {
    setIsExpanded(isListExpanded);
  }, [isListExpanded]);
  return (
    <EntryContainer>
      <Stack gap="sm">
        <HeaderRow>
          <Group gap="sm">
            <TimestampText>{timestamp}</TimestampText>
            <Badge color="dark">{method}</Badge>
            {target && <TargetText>{target}</TargetText>}
          </Group>
          <Group gap="sm">
            <DurationText>{formatDuration(durationMs)}</DurationText>
            <Badge color={statusColor(status)}>
              {formatStatusLabel(status)}
            </Badge>
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

        {isExpanded && (
          <Collapse in={isExpanded}>
            <Stack gap="sm">
              {parameters && (
                <>
                  <Divider />
                  <Stack gap="xs">
                    <Text size="sm">Parameters:</Text>
                    <ContentViewer
                      block={{
                        type: "text",
                        text: serializeJson(parameters),
                      }}
                      copyable
                    />
                  </Stack>
                </>
              )}
              {response && (
                <Stack gap="xs">
                  <Text size="sm">Response:</Text>
                  <ContentViewer
                    block={{
                      type: "text",
                      text: serializeJson(response),
                    }}
                    copyable
                  />
                </Stack>
              )}
              {childEntries && childEntries.length > 0 && (
                <Stack gap="xs">
                  {childEntries.map((child, index) => (
                    <Group key={index} pl="lg" gap="sm">
                      <TimestampText>+-- </TimestampText>
                      <TimestampText>{child.timestamp}</TimestampText>
                      <ChildMethodBadge>{child.method}</ChildMethodBadge>
                      {child.target && <Text size="sm">{child.target}</Text>}
                      <Badge color={statusColor(child.status)} size="sm">
                        {formatStatusLabel(child.status)}
                      </Badge>
                      <DurationText>
                        {formatDuration(child.durationMs)}
                      </DurationText>
                    </Group>
                  ))}
                </Stack>
              )}
            </Stack>
          </Collapse>
        )}
      </Stack>
    </EntryContainer>
  );
}
