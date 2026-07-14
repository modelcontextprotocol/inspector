import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Collapse,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import type { MessageEntry } from "../../../../../../core/mcp/types.js";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { MessageDirectionBadge } from "../../elements/MessageDirectionBadge/MessageDirectionBadge";
import { MethodBadge } from "../../elements/MethodBadge/MethodBadge";
import { ExpandToggle } from "../../elements/ExpandToggle/ExpandToggle";
import { PinToggle } from "../../elements/PinToggle/PinToggle";
import { ReplayButton } from "../../elements/ReplayButton/ReplayButton";
import { extractMethod, isReplayableProtocolMethod } from "../protocolUtils.js";

export interface ProtocolEntryProps {
  entry: MessageEntry;
  isPinned: boolean;
  isListExpanded: boolean;
  onReplay: () => void;
  onTogglePin: () => void;
  /**
   * Compact two-line header for the narrow monitoring sidebar (#1616): line 1 is
   * time + direction + duration + status; line 2 is the method (and target) with
   * the controls — Replay as an icon — on the right.
   */
  embedded?: boolean;
}

const EntryContainer = Card.withProps({
  withBorder: true,
  padding: "md",
  variant: "inset",
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

// Left / right clusters within a compact header line. The left cluster shrinks
// (`miw: 0`) so a long target can truncate rather than push the row wider.
const HeaderCluster = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
  miw: 0,
});

const ControlsCluster = Group.withProps({
  gap: "xs",
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

// Compact-header target (e.g. a long resource URI): never wraps, so it scrolls
// horizontally inside its ScrollArea instead of truncating with an ellipsis
// (mirrors NetworkEntry's URL).
const TargetScroll = Text.withProps({
  size: "sm",
  fw: 500,
  variant: "nowrap",
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

// Time-only (HH:MM:SS, UTC) for the compact column header, where the full ISO
// string would eat most of the narrow line-1 width (#1616).
function formatTimestampCompact(date: Date): string {
  return date.toISOString().slice(11, 19);
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

export function ProtocolEntry({
  entry,
  isPinned,
  isListExpanded,
  onReplay,
  onTogglePin,
  embedded = false,
}: ProtocolEntryProps) {
  const [isExpanded, setIsExpanded] = useState(isListExpanded);
  const method = extractMethod(entry);
  const target = extractTarget(entry);
  const status = extractStatus(entry);
  const canReplay = isReplayableProtocolMethod(method);

  useEffect(() => {
    setIsExpanded(isListExpanded);
  }, [isListExpanded]);

  const directionBadge = entry.origin && (
    <MessageDirectionBadge
      direction={entry.origin === "client" ? "outgoing" : "incoming"}
    />
  );
  const statusBadge = status !== "none" && (
    <Badge color={statusColor(status)} variant="status">
      {statusLabel(status)}
    </Badge>
  );
  const durationText = entry.duration != null && (
    <DurationText>{formatDuration(entry.duration)}</DurationText>
  );

  return (
    <EntryContainer>
      <Stack gap="sm">
        {embedded ? (
          // Compact two-line header for the narrow column.
          <Stack gap="xs">
            <HeaderRow>
              <HeaderCluster>
                <TimestampText>
                  {formatTimestampCompact(entry.timestamp)}
                </TimestampText>
                {directionBadge}
              </HeaderCluster>
              <ControlsCluster>
                {durationText}
                {statusBadge}
              </ControlsCluster>
            </HeaderRow>
            <HeaderRow>
              <HeaderCluster flex={1}>
                <MethodBadge method={method} />
                {target && (
                  <ScrollArea
                    scrollbarSize={6}
                    flex={1}
                    miw={0}
                    // The target scrolls horizontally but has no focusable child,
                    // so make the viewport itself keyboard-scrollable (WCAG SC
                    // 2.1.1). Scrollbar auto-hides via the `type="scroll"` theme
                    // default.
                    viewportProps={{ tabIndex: 0 }}
                  >
                    <TargetScroll>{target}</TargetScroll>
                  </ScrollArea>
                )}
              </HeaderCluster>
              <ControlsCluster>
                {canReplay && <ReplayButton onReplay={onReplay} />}
                <PinToggle pinned={isPinned} onToggle={onTogglePin} />
                <ExpandToggle
                  expanded={isExpanded}
                  onToggle={() => setIsExpanded((v) => !v)}
                />
              </ControlsCluster>
            </HeaderRow>
          </Stack>
        ) : (
          <>
            <HeaderRow>
              <Group gap="sm">
                <TimestampText>
                  {formatTimestamp(entry.timestamp)}
                </TimestampText>
                {directionBadge}
                <MethodBadge method={method} />
                {target && <TargetText>{target}</TargetText>}
              </Group>
              <Group gap="sm">
                {durationText}
                {statusBadge}
              </Group>
            </HeaderRow>

            <Group gap="xs" justify="space-between">
              <Group gap="xs">
                {canReplay && (
                  <SubtleButton onClick={onReplay}>Replay</SubtleButton>
                )}
              </Group>
              <Group gap="xs">
                <PinToggle pinned={isPinned} onToggle={onTogglePin} />
                <ExpandToggle
                  expanded={isExpanded}
                  onToggle={() => setIsExpanded((v) => !v)}
                />
              </Group>
            </Group>
          </>
        )}

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
