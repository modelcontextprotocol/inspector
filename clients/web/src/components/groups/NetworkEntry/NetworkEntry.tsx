import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Divider,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { RiErrorWarningLine } from "react-icons/ri";
import type { FetchRequestEntry } from "@inspector/core/mcp/types.js";
import { isLongLivedStreamResponse } from "@inspector/core/mcp/fetchTracking.js";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { CopyButton } from "../../elements/CopyButton/CopyButton";
import { ExpandToggle } from "../../elements/ExpandToggle/ExpandToggle";
import { MethodBadge } from "../../elements/MethodBadge/MethodBadge";
import { CategoryBadge } from "../../elements/CategoryBadge/CategoryBadge";
import { McpErrorBadge } from "../../elements/McpErrorBadge/McpErrorBadge";
import { maskSecretsInBody } from "../../../utils/maskSecrets";
import {
  oauthNetworkPhase,
  oauthNetworkPhaseLabel,
} from "../../../utils/oauthNetworkPhase";
import {
  checkHeaderConsistency,
  classifyMcpSpecError,
  decodeMcpParamValue,
  isCancellationAbort,
  isMcpHeader,
  type HeaderConsistency,
  type McpSpecError,
} from "../../../utils/mcpNetworkHeaders";

export interface NetworkEntryProps {
  entry: FetchRequestEntry;
  isListExpanded: boolean;
  /**
   * Compact two-line header for the narrow monitoring sidebar (#1616): line 1 is
   * time + method + category + duration + status; line 2 is the URL in a
   * horizontal scroll area with the expand toggle on the right.
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

const TimestampText = Text.withProps({
  size: "sm",
  c: "dimmed",
  ff: "monospace",
});

const UrlText = Text.withProps({
  size: "sm",
  fw: 500,
  truncate: "end",
});

// Compact-header URL: never wraps, so a long URL scrolls horizontally inside its
// ScrollArea instead of wrapping to many lines.
const UrlScroll = Text.withProps({
  size: "sm",
  fw: 500,
  variant: "nowrap",
});

// Left / right clusters for a compact header line (mirrors ProtocolEntry).
const HeaderCluster = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
  miw: 0,
});

const ControlsCluster = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
});

const DurationText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

// Cap is in JS string `.length` units (UTF-16 code units), not bytes — for
// multi-byte content the wire size is larger, but the limit's purpose is
// to keep the DOM from drowning in a single Code block so character count
// is the right unit.
const MAX_INLINE_BODY_CHARS = 100_000;

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

function statusColor(entry: FetchRequestEntry): string {
  // A cancelled request surfaces as a connection abort under the modern
  // transport; render it neutrally rather than as a hard error (SEP §7.5).
  if (isCancellationAbort(entry)) return "gray";
  if (entry.error) return "red";
  const status = entry.responseStatus;
  if (status === undefined) return "gray";
  if (status >= 500) return "red";
  if (status >= 400) return "orange";
  if (status >= 300) return "yellow";
  if (status >= 200) return "green";
  return "gray";
}

function statusLabel(entry: FetchRequestEntry): string {
  if (isCancellationAbort(entry)) return "Cancelled";
  if (entry.error) return "Error";
  if (entry.responseStatus === undefined) return "Pending";
  return entry.responseStatusText
    ? `${entry.responseStatus} ${entry.responseStatusText}`
    : `${entry.responseStatus}`;
}

function isLongLivedStream(entry: FetchRequestEntry): boolean {
  return isLongLivedStreamResponse(
    entry.method,
    entry.responseHeaders?.["content-type"],
  );
}

// Header-table cell text. A modern MCP-mirrored header name gets a violet accent
// so the spec headers (Mcp-Method / Mcp-Name / Mcp-Param-* / MCP-Protocol-Version)
// stand out from ordinary ones; a value that disagrees with the request body is
// shown in the danger colour.
const HeaderNameText = Text.withProps({
  size: "xs",
  ff: "monospace",
  fw: 500,
});

const McpHeaderNameText = Text.withProps({
  size: "xs",
  ff: "monospace",
  fw: 600,
  c: "var(--inspector-mcp-header-accent)",
});

const HeaderValueText = Text.withProps({
  size: "xs",
  ff: "monospace",
  variant: "monoBreak",
});

const MismatchValueText = Text.withProps({
  size: "xs",
  ff: "monospace",
  variant: "monoBreak",
  c: "var(--inspector-danger-text)",
});

const MismatchMarker = Text.withProps({
  component: "span",
  // role="img" makes the aria-label permitted on the span (it wraps a decorative
  // icon) and announces the mismatch to assistive tech.
  role: "img",
  c: "var(--inspector-danger-text)",
});

function HeaderValueCell({
  name,
  value,
  consistency,
}: {
  name: string;
  value: string;
  consistency?: HeaderConsistency;
}) {
  // Only modern MCP headers carry sentinel-encoded values; a plain header is
  // shown verbatim (never re-interpreted as base64).
  const decoded = isMcpHeader(name)
    ? decodeMcpParamValue(value)
    : { value, encoded: false, raw: value };
  const mismatch = consistency !== undefined && !consistency.ok;

  return (
    <Group gap="xs" wrap="nowrap" align="center">
      {mismatch ? (
        <MismatchValueText>{decoded.value}</MismatchValueText>
      ) : (
        <HeaderValueText>{decoded.value}</HeaderValueText>
      )}
      {decoded.encoded && (
        <Tooltip
          label={`base64 sentinel — raw: ${decoded.raw}`}
          withArrow
          multiline
          w={280}
        >
          <Badge size="xs" color="gray" variant="light">
            base64
          </Badge>
        </Tooltip>
      )}
      {mismatch && (
        <Tooltip
          label={`Expected: ${consistency.expected}`}
          withArrow
          multiline
          w={280}
        >
          <MismatchMarker
            aria-label={`Header does not match body; expected ${consistency.expected}`}
          >
            <RiErrorWarningLine />
          </MismatchMarker>
        </Tooltip>
      )}
    </Group>
  );
}

function HeadersTable({
  headers,
  consistency,
}: {
  headers: Record<string, string>;
  /** Header/body cross-checks (request side only) to flag mismatches. */
  consistency?: HeaderConsistency[];
}) {
  const rows = Object.entries(headers);
  if (rows.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        (none)
      </Text>
    );
  }
  const byHeader = new Map((consistency ?? []).map((row) => [row.header, row]));
  return (
    <Table striped withColumnBorders fz="xs">
      <Table.Tbody>
        {rows.map(([name, value]) => (
          <Table.Tr key={name}>
            <Table.Td>
              {isMcpHeader(name) ? (
                <McpHeaderNameText>{name}</McpHeaderNameText>
              ) : (
                <HeaderNameText>{name}</HeaderNameText>
              )}
            </Table.Td>
            <Table.Td>
              <HeaderValueCell
                name={name}
                value={value}
                consistency={byHeader.get(name.toLowerCase())}
              />
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

// Friendly summary of a modern spec error (SEP-2243 / SEP-2575) above the raw
// response body — names the code, explains it, and for -32022 lists the
// server-supported protocol versions.
function McpSpecErrorAlert({ error }: { error: McpSpecError }) {
  // A single AA-safe severity accent — the per-code colour distinction lives in
  // the McpErrorBadge; the Alert names the code in its title text.
  return (
    <Alert
      variant="light"
      color="red"
      title={`${error.code} ${error.name}`}
      icon={<RiErrorWarningLine />}
    >
      <Stack gap="xs">
        <Text size="xs">{error.description}</Text>
        <Text size="xs" c="dimmed">
          {error.actualHttpStatus != null
            ? `HTTP ${error.actualHttpStatus} (spec: ${error.expectedHttpStatus}).`
            : `Spec HTTP status: ${error.expectedHttpStatus}.`}
        </Text>
        {error.supported && (
          <Text size="xs">Server supports: {error.supported.join(", ")}</Text>
        )}
      </Stack>
    </Alert>
  );
}

const CancellationAlert = Alert.withProps({
  variant: "light",
  color: "gray",
  title: "Request cancelled",
  icon: <RiErrorWarningLine />,
});

const RevealButton = Button.withProps({
  variant: "subtle",
  size: "compact-xs",
});

function BodyPreview({
  body,
  contentType,
}: {
  body: string;
  contentType?: string;
}) {
  // Reveal state for masked secrets. Hooks run before any early return so the
  // order stays stable across the too-large / has-secrets branches. The reveal
  // state resets when the body or its content-type changes because callers key
  // `<BodyPreview>` by both (remounting on swap), so a previously-revealed view
  // never persists across a content (or masking) change.
  const [revealed, setRevealed] = useState(false);

  const tooLarge = body.length > MAX_INLINE_BODY_CHARS;

  // OAuth responses (token exchange, DCR) and the token request carry
  // bearer-grade secrets. Mask them by default and gate the raw values behind
  // an explicit reveal so they aren't exposed at a glance during a
  // screen-share. The entry's content-type scopes which parser runs (so a
  // plaintext/HTML error body is never guessed at). Bodies without secrets
  // render as-is with no toggle.
  //
  // Memoized so a Reveal/Hide click (a re-render) doesn't re-parse and re-walk
  // the body; the cost is paid once per mount, and the `key={…}` remount on
  // body/content-type change re-runs it. Skipped for too-large bodies so we
  // never parse something we won't display (the hook must run unconditionally,
  // hence the in-memo guard rather than an early return above it).
  const { masked, hasSecrets } = useMemo(
    () =>
      tooLarge
        ? { masked: body, hasSecrets: false }
        : maskSecretsInBody(body, contentType),
    [tooLarge, body, contentType],
  );

  if (tooLarge) {
    return (
      <Text size="xs" c="dimmed">
        Body too large to preview ({body.length} characters)
      </Text>
    );
  }

  if (!hasSecrets) {
    return <ContentViewer block={{ type: "text", text: body }} copyable />;
  }

  const shown = revealed ? body : masked;
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Text size="xs" c="dimmed" aria-live="polite">
          {revealed ? "Secrets revealed" : "Secrets hidden"}
        </Text>
        <RevealButton
          onClick={() => setRevealed((v) => !v)}
          aria-label={
            revealed ? "Hide secrets in body" : "Reveal secrets in body"
          }
        >
          {revealed ? "Hide" : "Reveal"}
        </RevealButton>
      </Group>
      <ContentViewer block={{ type: "text", text: shown }} copyable />
    </Stack>
  );
}

export function NetworkEntry({
  entry,
  isListExpanded,
  embedded = false,
}: NetworkEntryProps) {
  const [isExpanded, setIsExpanded] = useState(isListExpanded);

  // The list-level Expand/Collapse toggle is authoritative: each time the
  // parent changes `isListExpanded`, every entry snaps to that state and
  // any per-entry override is intentionally discarded. Mirrors
  // ProtocolEntry; do not change without aligning both. This re-runs on
  // re-render when `isListExpanded` keeps its reference, but the setter
  // is a no-op when the next value equals the current one.
  useEffect(() => {
    setIsExpanded(isListExpanded);
  }, [isListExpanded]);

  // OAuth flow phase for `auth`-category requests (discovery / registration /
  // authorize / token), so the Network tab labels the auth conversation.
  const oauthPhase =
    entry.category === "auth" ? oauthNetworkPhase(entry.url) : undefined;
  const phaseBadge = oauthPhase ? (
    <Badge color="violet" variant="light">
      {oauthNetworkPhaseLabel(oauthPhase)}
    </Badge>
  ) : null;

  // Modern Streamable HTTP awareness (SEP-2243 / SEP-2575): a recognised spec
  // error to badge distinctly, and request header/body cross-checks so a
  // HeaderMismatch is visible before the server even rejects it. Both are pure
  // functions of the (immutable) entry, so memoise on it.
  const specError = useMemo(() => classifyMcpSpecError(entry), [entry]);
  const headerConsistency = useMemo(
    () => checkHeaderConsistency(entry),
    [entry],
  );
  const aborted = isCancellationAbort(entry);

  // The spec-error chip is rendered separately from `metaBadges` so the two
  // layouts can place it where there's room: on the compact sidebar it would
  // crowd and truncate the (already tight) top row, so it sits on the second
  // row beside the URL; the full-width layout keeps it in the top-right cluster.
  const specErrorBadge = specError ? (
    <McpErrorBadge
      code={specError.code}
      name={specError.name}
      description={specError.description}
    />
  ) : null;

  const metaBadges = (
    <>
      {entry.duration != null && (
        <DurationText>{formatDuration(entry.duration)}</DurationText>
      )}
      {isLongLivedStream(entry) && <Badge color="orange">SSE</Badge>}
      <Badge color={statusColor(entry)} variant="status">
        {statusLabel(entry)}
      </Badge>
    </>
  );
  const expandToggle = (
    <ExpandToggle
      expanded={isExpanded}
      onToggle={() => setIsExpanded((v) => !v)}
    />
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
                <MethodBadge method={entry.method} />
                <CategoryBadge category={entry.category} />
                {phaseBadge}
              </HeaderCluster>
              <ControlsCluster>{metaBadges}</ControlsCluster>
            </HeaderRow>
            <Group gap="xs" wrap="nowrap" justify="space-between">
              <CopyButton value={entry.url} />
              <ScrollArea
                scrollbarSize={6}
                flex={1}
                miw={0}
                // The URL scrolls horizontally but has no focusable child, so
                // make the viewport itself keyboard-scrollable (WCAG SC 2.1.1).
                // Scrollbar auto-hides via the `type="scroll"` theme default.
                viewportProps={{ tabIndex: 0 }}
              >
                <UrlScroll>{entry.url}</UrlScroll>
              </ScrollArea>
              {specErrorBadge}
              {expandToggle}
            </Group>
          </Stack>
        ) : (
          <>
            <HeaderRow>
              <Group gap="sm" wrap="nowrap" miw={0} flex={1}>
                <TimestampText>
                  {formatTimestamp(entry.timestamp)}
                </TimestampText>
                <MethodBadge method={entry.method} />
                <CategoryBadge category={entry.category} />
                {phaseBadge}
                <CopyButton value={entry.url} />
                <UrlText>{entry.url}</UrlText>
              </Group>
              <Group gap="sm" wrap="nowrap">
                {specErrorBadge}
                {metaBadges}
              </Group>
            </HeaderRow>

            <Group gap="xs" justify="flex-end">
              {expandToggle}
            </Group>
          </>
        )}

        <Collapse in={isExpanded}>
          <Stack gap="sm">
            <Divider />
            {specError && <McpSpecErrorAlert error={specError} />}
            {aborted && (
              <CancellationAlert>
                <Text size="xs">
                  Cancellation appears as a connection abort — the modern
                  transport aborts the request stream instead of sending a{" "}
                  <Text span ff="monospace">
                    notifications/cancelled
                  </Text>{" "}
                  frame (SEP §7.5).
                </Text>
              </CancellationAlert>
            )}
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                Request Headers
              </Text>
              <HeadersTable
                headers={entry.requestHeaders}
                consistency={headerConsistency}
              />
            </Stack>
            {entry.requestBody && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  Request Body
                </Text>
                <BodyPreview
                  key={`${entry.requestHeaders["content-type"] ?? ""}|${entry.requestBody}`}
                  body={entry.requestBody}
                  contentType={entry.requestHeaders["content-type"]}
                />
              </Stack>
            )}
            {entry.responseHeaders && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  Response Headers
                </Text>
                <HeadersTable headers={entry.responseHeaders} />
              </Stack>
            )}
            {entry.responseStatus !== undefined && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  Response Body
                </Text>
                {entry.responseBody ? (
                  <BodyPreview
                    key={`${entry.responseHeaders?.["content-type"] ?? ""}|${entry.responseBody}`}
                    body={entry.responseBody}
                    contentType={entry.responseHeaders?.["content-type"]}
                  />
                ) : (
                  <Text size="xs" c="dimmed">
                    {isLongLivedStream(entry)
                      ? "Long-lived stream — body not captured"
                      : "(empty)"}
                  </Text>
                )}
              </Stack>
            )}
            {entry.error && (
              <Stack gap="xs">
                <Text size="sm" fw={500} c="red">
                  Error
                </Text>
                <Text size="xs" ff="monospace" c="red">
                  {entry.error}
                </Text>
              </Stack>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </EntryContainer>
  );
}
