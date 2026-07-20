import { useEffect, useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Card,
  Collapse,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { RiErrorWarningLine } from "react-icons/ri";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { CopyButton } from "../../elements/CopyButton/CopyButton";
import { MessageDirectionBadge } from "../../elements/MessageDirectionBadge/MessageDirectionBadge";
import { MethodBadge } from "../../elements/MethodBadge/MethodBadge";
import { McpErrorBadge } from "../../elements/McpErrorBadge/McpErrorBadge";
import { ExpandToggle } from "../../elements/ExpandToggle/ExpandToggle";
import { PinToggle } from "../../elements/PinToggle/PinToggle";
import { ReplayButton } from "../../elements/ReplayButton/ReplayButton";
import {
  classifyProtocolSpecError,
  type McpSpecError,
} from "../../../utils/mcpNetworkHeaders";
import {
  extractMethod,
  extractResultType,
  extractSubscriptionId,
  isReplayableProtocolMethod,
} from "../protocolUtils.js";

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
  /**
   * When provided (a spec-error entry with a correlated Network request), the
   * expanded alert shows a "view in Network" link that jumps to, and expands,
   * the matching HTTP entry.
   */
  onRevealInNetwork?: () => void;
  /**
   * HTTP status of this entry's correlated Network fetch, when known. Used to
   * gate the generic `-32601` to a genuine modern 404 (an in-band `-32601` on a
   * 200 is an ordinary error, not the modern taxonomy). Omitted when there is no
   * correlated HTTP record.
   */
  correlatedHttpStatus?: number;
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

// The `subscriptionId` tag on a modern push notification (spec §7.4). Shown with
// a copy button so the id can be correlated against the `subscriptions/listen`
// stream that opened it.
const SubscriptionLabel = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const SubscriptionId = Text.withProps({
  size: "sm",
  ff: "monospace",
});

const SubscriptionCluster = Group.withProps({
  gap: 4,
  wrap: "nowrap",
  miw: 0,
});

// `complete` is green — it's the success signal now that the redundant "OK"
// status badge is suppressed, so a modern success keeps the same at-a-glance
// green affordance a legacy success has. `input_required` is yellow (in
// progress: awaiting input before the retry).
function resultTypeColor(resultType: "complete" | "input_required"): string {
  return resultType === "input_required" ? "yellow" : "green";
}

function resultTypeLabel(resultType: "complete" | "input_required"): string {
  return resultType === "input_required" ? "input required" : "complete";
}

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

// The resource URI when the target is one (e.g. `resources/read`), so it can be
// copied. Tool/prompt targets are plain names, not URIs, and get no copy button.
function extractResourceUri(entry: MessageEntry): string | undefined {
  const msg = entry.message;
  if (!("params" in msg) || !msg.params) return undefined;
  const params = msg.params as Record<string, unknown>;
  return typeof params.uri === "string" ? params.uri : undefined;
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

// The JSON-RPC error carried by a message — either the folded error `response`
// on a request, or an error message frame itself — classified as a modern spec
// error (SEP-2243 / SEP-2575) or null. Protocol errors the SDK throws rather
// than delivers (e.g. -32601) are folded onto the pending request upstream (see
// `enrichProtocolEntries`), so they land here too.
function extractSpecError(
  entry: MessageEntry,
  httpStatus?: number,
): McpSpecError | null {
  const error =
    entry.response && "error" in entry.response
      ? entry.response.error
      : "error" in entry.message
        ? entry.message.error
        : undefined;
  if (!error || typeof error.code !== "number") return null;
  return classifyProtocolSpecError(error.code, error.data, httpStatus);
}

// Friendly summary of a modern spec error, shown in the expanded detail. The
// HTTP-level facts (status, mirrored headers) live on the correlated Network
// entry, reachable via the "view in Network" link when one exists.
function McpSpecErrorAlert({
  error,
  onReveal,
}: {
  error: McpSpecError;
  onReveal?: () => void;
}) {
  return (
    <Alert
      variant="light"
      color="red"
      title={`${error.code} ${error.name}`}
      icon={<RiErrorWarningLine />}
    >
      <Stack gap="xs">
        <Text size="xs">{error.description}</Text>
        {error.supported && (
          <Text size="xs">Server supports: {error.supported.join(", ")}</Text>
        )}
        {onReveal && (
          <Anchor component="button" type="button" size="xs" onClick={onReveal}>
            View the HTTP request in the Network tab →
          </Anchor>
        )}
      </Stack>
    </Alert>
  );
}

export function ProtocolEntry({
  entry,
  isPinned,
  isListExpanded,
  onReplay,
  onTogglePin,
  embedded = false,
  onRevealInNetwork,
  correlatedHttpStatus,
}: ProtocolEntryProps) {
  const [isExpanded, setIsExpanded] = useState(isListExpanded);
  const method = extractMethod(entry);
  const target = extractTarget(entry);
  const resourceUri = extractResourceUri(entry);
  const status = extractStatus(entry);
  const canReplay = isReplayableProtocolMethod(method);
  const resultType = extractResultType(entry);
  const subscriptionId = extractSubscriptionId(entry);

  useEffect(() => {
    setIsExpanded(isListExpanded);
  }, [isListExpanded]);

  const directionBadge = entry.origin && (
    <MessageDirectionBadge
      direction={entry.origin === "client" ? "outgoing" : "incoming"}
    />
  );
  // Distinct chip for a modern spec error (SEP-2243 / SEP-2575). Shown only in
  // the wide layout (right after the method chip); the compact sidebar relies on
  // its ERROR status badge to keep the two-line row uncluttered.
  const specError = extractSpecError(entry, correlatedHttpStatus);
  const specErrorBadge = specError && (
    <McpErrorBadge
      code={specError.code}
      name={specError.name}
      description={specError.description}
    />
  );
  // The modern `resultType` on the paired result (spec §7.3): `input_required`
  // (the operation isn't done — it needs input and will be retried) vs the
  // ordinary `complete`. Only present on modern results, so it doubles as a
  // per-result modern signal without inferring the connection era.
  const resultTypeBadge = resultType && (
    <Badge color={resultTypeColor(resultType)} variant="status">
      {resultTypeLabel(resultType)}
    </Badge>
  );
  // Suppress the redundant green "OK" when a `resultType` badge already conveys
  // the outcome (a modern success is `complete`/`input required`); errors and
  // pending have no `resultType`, so their status badge still shows.
  const statusBadge = status !== "none" && !resultType && (
    <Badge color={statusColor(status)} variant="status">
      {statusLabel(status)}
    </Badge>
  );
  const subscriptionBadge = subscriptionId && (
    <SubscriptionCluster>
      <SubscriptionLabel>sub</SubscriptionLabel>
      <CopyButton value={subscriptionId} />
      <SubscriptionId>{subscriptionId}</SubscriptionId>
    </SubscriptionCluster>
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
                {resultTypeBadge}
                {statusBadge}
                {/* The subscription-id tag rides the top line's trailing edge
                    (a notification row's duration/status slots are empty) so the
                    method badge on the line below gets the full column width and
                    doesn't truncate against the pin control (#1630). */}
                {subscriptionBadge}
              </ControlsCluster>
            </HeaderRow>
            <HeaderRow>
              <HeaderCluster flex={1}>
                <MethodBadge method={method} />
                {target && (
                  <>
                    {resourceUri && <CopyButton value={resourceUri} />}
                    <ScrollArea
                      scrollbarSize={6}
                      flex={1}
                      miw={0}
                      // The target scrolls horizontally but has no focusable
                      // child, so make the viewport itself keyboard-scrollable
                      // (WCAG SC 2.1.1). Scrollbar auto-hides via the
                      // `type="scroll"` theme default.
                      viewportProps={{ tabIndex: 0 }}
                    >
                      <TargetScroll>{target}</TargetScroll>
                    </ScrollArea>
                  </>
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
                {specErrorBadge}
                {subscriptionBadge}
                {target && (
                  <>
                    {resourceUri && <CopyButton value={resourceUri} />}
                    <TargetText>{target}</TargetText>
                  </>
                )}
              </Group>
              <Group gap="sm">
                {durationText}
                {resultTypeBadge}
                {statusBadge}
              </Group>
            </HeaderRow>

            <Group gap="xs" justify="flex-end">
              {canReplay && <ReplayButton onReplay={onReplay} />}
              <PinToggle pinned={isPinned} onToggle={onTogglePin} />
              <ExpandToggle
                expanded={isExpanded}
                onToggle={() => setIsExpanded((v) => !v)}
              />
            </Group>
          </>
        )}

        <Collapse in={isExpanded}>
          <Stack gap="sm">
            <Divider />
            {specError && (
              <McpSpecErrorAlert
                error={specError}
                // Only header/HTTP-status errors gain from the raw HTTP entry;
                // a protocol-only error (e.g. -32021) shows no link.
                onReveal={
                  specError.httpRelevant ? onRevealInNetwork : undefined
                }
              />
            )}
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
