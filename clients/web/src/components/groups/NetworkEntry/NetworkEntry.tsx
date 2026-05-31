import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Collapse,
  Divider,
  Group,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import type { FetchRequestEntry } from "@inspector/core/mcp/types.js";
import { isLongLivedStreamResponse } from "@inspector/core/mcp/fetchTracking.js";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { maskSecretsInBody } from "../../../utils/maskSecrets";

export interface NetworkEntryProps {
  entry: FetchRequestEntry;
  isListExpanded: boolean;
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

const UrlText = Text.withProps({
  size: "sm",
  fw: 500,
  truncate: "end",
});

const DurationText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const SubtleButton = Button.withProps({
  variant: "subtle",
  size: "xs",
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

function statusColor(entry: FetchRequestEntry): string {
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
  if (entry.error) return "Error";
  if (entry.responseStatus === undefined) return "Pending";
  return entry.responseStatusText
    ? `${entry.responseStatus} ${entry.responseStatusText}`
    : `${entry.responseStatus}`;
}

function categoryColor(category: FetchRequestEntry["category"]): string {
  return category === "auth" ? "violet" : "blue";
}

function isLongLivedStream(entry: FetchRequestEntry): boolean {
  return isLongLivedStreamResponse(
    entry.method,
    entry.responseHeaders?.["content-type"],
  );
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const rows = Object.entries(headers);
  if (rows.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        (none)
      </Text>
    );
  }
  return (
    <Table striped withColumnBorders fz="xs">
      <Table.Tbody>
        {rows.map(([name, value]) => (
          <Table.Tr key={name}>
            <Table.Td>
              <Text size="xs" ff="monospace" fw={500}>
                {name}
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs" ff="monospace" variant="monoBreak">
                {value}
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

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
  // state resets when the body content changes because callers key
  // `<BodyPreview>` by `body` (remounting on swap), so a previously-revealed
  // view never persists across a content change.
  const [revealed, setRevealed] = useState(false);

  const tooLarge = body.length > MAX_INLINE_BODY_CHARS;
  if (tooLarge) {
    return (
      <Text size="xs" c="dimmed">
        Body too large to preview ({body.length} characters)
      </Text>
    );
  }

  // OAuth responses (token exchange, DCR) and the token request carry
  // bearer-grade secrets. Mask them by default and gate the raw values behind
  // an explicit reveal so they aren't exposed at a glance during a
  // screen-share. The entry's content-type scopes which parser runs (so a
  // plaintext/HTML error body is never guessed at). Bodies without secrets
  // render as-is with no toggle.
  const { masked, hasSecrets } = maskSecretsInBody(body, contentType);
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

export function NetworkEntry({ entry, isListExpanded }: NetworkEntryProps) {
  const [isExpanded, setIsExpanded] = useState(isListExpanded);

  // The list-level Expand/Collapse toggle is authoritative: each time the
  // parent changes `isListExpanded`, every entry snaps to that state and
  // any per-entry override is intentionally discarded. Mirrors
  // HistoryEntry; do not change without aligning both. This re-runs on
  // re-render when `isListExpanded` keeps its reference, but the setter
  // is a no-op when the next value equals the current one.
  useEffect(() => {
    setIsExpanded(isListExpanded);
  }, [isListExpanded]);

  return (
    <EntryContainer>
      <Stack gap="sm">
        <HeaderRow>
          <Group gap="sm" wrap="nowrap" miw={0} flex={1}>
            <TimestampText>{formatTimestamp(entry.timestamp)}</TimestampText>
            <Badge color="dark">{entry.method}</Badge>
            <Badge color={categoryColor(entry.category)} variant="light">
              {entry.category}
            </Badge>
            <UrlText>{entry.url}</UrlText>
          </Group>
          <Group gap="sm" wrap="nowrap">
            {entry.duration != null && (
              <DurationText>{formatDuration(entry.duration)}</DurationText>
            )}
            {isLongLivedStream(entry) && <Badge color="orange">SSE</Badge>}
            <Badge color={statusColor(entry)}>{statusLabel(entry)}</Badge>
          </Group>
        </HeaderRow>

        <Group gap="xs">
          <SubtleButton onClick={() => setIsExpanded((v) => !v)} ml="auto">
            {isExpanded ? "Collapse" : "Expand"}
          </SubtleButton>
        </Group>

        <Collapse in={isExpanded}>
          <Stack gap="sm">
            <Divider />
            <Stack gap="xs">
              <Text size="sm" fw={500}>
                Request Headers
              </Text>
              <HeadersTable headers={entry.requestHeaders} />
            </Stack>
            {entry.requestBody && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  Request Body
                </Text>
                <BodyPreview
                  key={entry.requestBody}
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
                    key={entry.responseBody}
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
