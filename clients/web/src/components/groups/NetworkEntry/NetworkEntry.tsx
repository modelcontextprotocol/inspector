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
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";

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

const MAX_INLINE_BODY_BYTES = 4096;

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

function BodyPreview({ body }: { body: string }) {
  const tooLarge = body.length > MAX_INLINE_BODY_BYTES;
  if (tooLarge) {
    return (
      <Text size="xs" c="dimmed">
        Body too large to preview ({body.length} bytes)
      </Text>
    );
  }
  return <ContentViewer block={{ type: "text", text: body }} copyable />;
}

export function NetworkEntry({ entry, isListExpanded }: NetworkEntryProps) {
  const [isExpanded, setIsExpanded] = useState(isListExpanded);

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
                <BodyPreview body={entry.requestBody} />
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
            {entry.responseBody && (
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  Response Body
                </Text>
                <BodyPreview body={entry.responseBody} />
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
