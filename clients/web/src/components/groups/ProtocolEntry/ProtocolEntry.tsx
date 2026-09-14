import { useState } from "react";
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
import type { Tool } from "@modelcontextprotocol/client";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { CopyButton } from "../../elements/CopyButton/CopyButton";
import { MessageDirectionBadge } from "../../elements/MessageDirectionBadge/MessageDirectionBadge";
import { MethodBadge } from "../../elements/MethodBadge/MethodBadge";
import { McpErrorBadge } from "../../elements/McpErrorBadge/McpErrorBadge";
import { ExpandToggle } from "../../elements/ExpandToggle/ExpandToggle";
import { PinToggle } from "../../elements/PinToggle/PinToggle";
import { ReplayButton } from "../../elements/ReplayButton/ReplayButton";
import { EditReplayButton } from "../../elements/EditReplayButton/EditReplayButton";
import { EditReplayModal } from "../EditReplayModal/EditReplayModal";
import { useValueChange } from "../../../hooks/useValueChange";
import {
  classifyProtocolSpecError,
  type McpSpecError,
} from "../../../utils/mcpNetworkHeaders";
import {
  extractMethod,
  extractResultType,
  extractSubscriptionId,
} from "../protocolUtils.js";
import { isReplayableProtocolMethod } from "../../../utils/replayableProtocolMethods";
import {
  replayableParams,
  type ReplayParamsOverride,
} from "../../../lib/protocolReplay";

export interface ProtocolEntryProps {
  entry: MessageEntry;
  isPinned: boolean;
  isListExpanded: boolean;
  /**
   * Re-issue this entry's request. Called with no argument by the Replay
   * button (the entry's own params, verbatim), and with an edited params object
   * by the Edit-and-replay modal — one dispatch path, two ways to supply the
   * params (#2151).
   */
  onReplay: (overrideParams?: ReplayParamsOverride) => void;
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
  /**
   * The connected server's tools, used only to tell whether an edited
   * `tools/call` argument would be coerced by the schema on the way out
   * (#2151). Optional: without it that one check is skipped, which is the right
   * answer when the tool list is not known rather than a reason to block.
   */
  tools?: Tool[];
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

// Friendly summary alert for a modern spec error (title is per-error, dynamic).
const SpecErrorAlert = Alert.withProps({
  variant: "light",
  color: "red",
  icon: <RiErrorWarningLine />,
});

// The client rejected an otherwise well-formed response (#1953). Distinct from
// SpecErrorAlert: nothing is wrong with the server's JSON-RPC frame — the
// Inspector's own decoding refused the result — so the title says who rejected it.
const ClientErrorAlert = Alert.withProps({
  variant: "light",
  color: "red",
  icon: <RiErrorWarningLine />,
  title: "Rejected by the Inspector",
});

// Link (button-styled) that jumps to the correlated HTTP entry in the Network tab.
const RevealLink = Anchor.withProps({
  component: "button",
  type: "button",
  size: "xs",
});

const TargetScrollArea = ScrollArea.withProps({
  scrollbarSize: 6,
  flex: 1,
  miw: 0,
  // The target scrolls horizontally but has no focusable child, so make the
  // viewport itself keyboard-scrollable (WCAG SC 2.1.1). Scrollbar auto-hides
  // via the `type="scroll"` theme default.
  viewportProps: { tabIndex: 0 },
});

// Trailing controls row (replay / pin / expand) in the wide layout.
const ToggleRow = Group.withProps({
  gap: "xs",
  justify: "flex-end",
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

// The request's `params` object, which the Edit-and-replay editor is seeded
// from and the expanded detail renders. `undefined` for a frame that carries
// none — a bare `tools/list`, or a response.
function extractParams(
  entry: MessageEntry,
): Record<string, unknown> | undefined {
  const msg = entry.message;
  if (!("params" in msg) || !msg.params) return undefined;
  return msg.params as Record<string, unknown>;
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
  // A response the CLIENT refused is an error whichever entry carries it, so
  // this is checked BEFORE the request-only lifecycle below (#1953).
  // messageLogState annotates the request entry when the response was folded
  // into one, but falls back to the standalone response frame when there was
  // no matching request (a trimmed log, or a reconnect boundary) — and that
  // entry would otherwise fall straight through to "none" and render no badge.
  if (entry.clientError) return "error";
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
    <SpecErrorAlert title={`${error.code} ${error.name}`}>
      <Stack gap="xs">
        <Text size="xs">{error.description}</Text>
        {error.supported && (
          <Text size="xs">Server supports: {error.supported.join(", ")}</Text>
        )}
        {onReveal && (
          <RevealLink onClick={onReveal}>
            View the HTTP request in the Network tab →
          </RevealLink>
        )}
      </Stack>
    </SpecErrorAlert>
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
  tools,
}: ProtocolEntryProps) {
  const [isExpanded, setIsExpanded] = useState(isListExpanded);
  const [isEditingReplay, setIsEditingReplay] = useState(false);
  const method = extractMethod(entry);
  const target = extractTarget(entry);
  const resourceUri = extractResourceUri(entry);
  const status = extractStatus(entry);
  const requestParams = extractParams(entry);
  const canReplay = isReplayableProtocolMethod(method);
  const editableParams = replayableParams(method, requestParams);
  const resultType = extractResultType(entry);
  const subscriptionId = extractSubscriptionId(entry);

  // The list-level Expand/Collapse toggle is authoritative: any per-entry
  // override is discarded whenever the parent changes `isListExpanded`.
  // Mirrors NetworkEntry; do not change without aligning both.
  useValueChange(isListExpanded, setIsExpanded);

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
  const statusBadge = status !== "none" &&
    (!resultType || entry.clientError) && (
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
  // Both replay affordances are gated on the same predicate, so a method that
  // cannot be replayed does not offer an editor that would fail on Send.
  const replayControls = canReplay && (
    <>
      <ReplayButton onReplay={() => onReplay()} />
      <EditReplayButton onClick={() => setIsEditingReplay(true)} />
    </>
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
                    <TargetScrollArea>
                      <TargetScroll>{target}</TargetScroll>
                    </TargetScrollArea>
                  </>
                )}
              </HeaderCluster>
              <ControlsCluster>
                {replayControls}
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

            <ToggleRow>
              {replayControls}
              <PinToggle pinned={isPinned} onToggle={onTogglePin} />
              <ExpandToggle
                expanded={isExpanded}
                onToggle={() => setIsExpanded((v) => !v)}
              />
            </ToggleRow>
          </>
        )}

        {canReplay && (
          <EditReplayModal
            opened={isEditingReplay}
            method={method}
            // Seeded with what replay will actually read, not the whole frame:
            // the editor must not offer a field that Send would drop.
            params={editableParams.params}
            droppedParamKeys={editableParams.dropped}
            // The whole list, not this entry's tool: `name` is editable, so the
            // schema to validate against is whichever the draft now names.
            tools={tools}
            onSend={onReplay}
            onClose={() => setIsEditingReplay(false)}
          />
        )}

        <Collapse in={isExpanded}>
          <Stack gap="sm">
            <Divider />
            {entry.clientError && (
              <ClientErrorAlert>
                <Text size="xs">{entry.clientError}</Text>
              </ClientErrorAlert>
            )}
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
            {requestParams && (
              <Stack gap="xs">
                <Text size="sm">Parameters:</Text>
                <ContentViewer
                  block={{
                    type: "text",
                    text: serializeMessage(requestParams),
                  }}
                  copyable
                  // Named, because an expanded entry holds two of these and a
                  // list holds many pairs — unnamed they all announce the same
                  // thing, leaving only the visible headings to tell them apart.
                  jsonLabel={`${method} request parameters JSON`}
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
                  jsonLabel={`${method} response JSON`}
                />
              </Stack>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </EntryContainer>
  );
}
