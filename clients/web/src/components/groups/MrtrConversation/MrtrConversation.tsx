import { useEffect, useState } from "react";
import {
  Badge,
  Collapse,
  Divider,
  Group,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { ProtocolEntry } from "../ProtocolEntry/ProtocolEntry";
import { ExpandToggle } from "../../elements/ExpandToggle/ExpandToggle";
import { MethodBadge } from "../../elements/MethodBadge/MethodBadge";
import { extractMethod, extractResultType } from "../protocolUtils.js";

export interface MrtrConversationProps {
  /** The opaque MRTR token that links this conversation's rounds. */
  requestState: string;
  /** The entries belonging to this conversation (one per JSON-RPC id). */
  rounds: MessageEntry[];
  /** Which of this conversation's rounds are pinned, by entry id. */
  pinnedIds: Set<string>;
  /** Whether rounds start expanded (mirrors the list-level compact toggle). */
  isListExpanded: boolean;
  /** Compact per-round layout for the narrow monitoring column. */
  embedded?: boolean;
  onReplay: (id: string) => void;
  onTogglePin: (id: string) => void;
}

// MRTR (multi-round-trip request, spec §7.3) makes one logical operation span
// several JSON-RPC ids: the original call returns `input_required`, the client
// answers and retries with a NEW id echoing `requestState`, repeating until a
// final `complete` result. This groups those rounds into one expandable unit so
// the operation reads as a single conversation instead of scattered calls.

const ConversationContainer = Paper.withProps({
  withBorder: true,
  p: "md",
  radius: "md",
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

const HeaderLeft = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
  miw: 0,
});

const HeaderRight = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
});

const MrtrLabel = Text.withProps({
  size: "sm",
  fw: 600,
  c: "dimmed",
});

const RoundLabel = Text.withProps({
  size: "xs",
  fw: 600,
  c: "dimmed",
});

type ConversationStatus = "pending" | "awaiting" | "error" | "complete";

// The conversation's status is that of its final (latest) round: still awaiting
// input if the last result is `input_required`, otherwise the ordinary
// pending/error/complete lifecycle of that round.
function conversationStatus(finalRound: MessageEntry): ConversationStatus {
  if (!finalRound.response) return "pending";
  if ("error" in finalRound.response) return "error";
  if (extractResultType(finalRound) === "input_required") return "awaiting";
  return "complete";
}

function statusColor(status: ConversationStatus): string {
  switch (status) {
    case "complete":
      return "green";
    case "error":
      return "red";
    case "awaiting":
      return "yellow";
    default:
      return "gray";
  }
}

function statusLabel(status: ConversationStatus): string {
  switch (status) {
    case "complete":
      return "Complete";
    case "error":
      return "Error";
    case "awaiting":
      return "Awaiting input";
    default:
      return "Pending";
  }
}

function formatRoundsLabel(count: number): string {
  return count === 1 ? "1 round" : `${count} rounds`;
}

function formatRoundLabel(index: number): string {
  return `Round ${index + 1}`;
}

export function MrtrConversation({
  requestState,
  rounds,
  pinnedIds,
  isListExpanded,
  embedded = false,
  onReplay,
  onTogglePin,
}: MrtrConversationProps) {
  const [isExpanded, setIsExpanded] = useState(isListExpanded);

  useEffect(() => {
    setIsExpanded(isListExpanded);
  }, [isListExpanded]);

  // Always read the conversation chronologically (original → retries → final),
  // regardless of the list's newest-first/oldest-first sort.
  const ordered = [...rounds].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  const method = extractMethod(ordered[0]);
  const status = conversationStatus(ordered[ordered.length - 1]);

  return (
    <ConversationContainer aria-label={`MRTR conversation ${requestState}`}>
      <Stack gap="sm">
        <HeaderRow>
          <HeaderLeft>
            <MethodBadge method={method} />
            <MrtrLabel>MRTR</MrtrLabel>
            <Badge color="blue" variant="outline">
              {formatRoundsLabel(ordered.length)}
            </Badge>
          </HeaderLeft>
          <HeaderRight>
            <Badge
              color={statusColor(status)}
              variant="status"
              data-testid="mrtr-status"
            >
              {statusLabel(status)}
            </Badge>
            <ExpandToggle
              expanded={isExpanded}
              ariaLabel={`${isExpanded ? "Collapse" : "Expand"} MRTR conversation`}
              onToggle={() => setIsExpanded((v) => !v)}
            />
          </HeaderRight>
        </HeaderRow>

        <Collapse in={isExpanded}>
          <Stack gap="sm">
            <Divider />
            {ordered.map((round, index) => (
              <Stack key={round.id} gap="xs">
                <RoundLabel>{formatRoundLabel(index)}</RoundLabel>
                <ProtocolEntry
                  entry={round}
                  isPinned={pinnedIds.has(round.id)}
                  isListExpanded={isListExpanded}
                  embedded={embedded}
                  onReplay={() => onReplay(round.id)}
                  onTogglePin={() => onTogglePin(round.id)}
                />
              </Stack>
            ))}
          </Stack>
        </Collapse>
      </Stack>
    </ConversationContainer>
  );
}
