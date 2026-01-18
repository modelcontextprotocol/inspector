import { useState } from 'react';
import {
  Card,
  Stack,
  Text,
  Badge,
  Group,
  Button,
  Code,
  Collapse,
  Box,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconPin,
  IconPinnedOff,
} from '@tabler/icons-react';
import type { HistoryEntry } from '@modelcontextprotocol/inspector-core';
import {
  formatRelativeTime,
  getChildSummary,
  getResponsePreview,
} from '@/lib/historyUtils';

interface HistoryTreeNodeProps {
  entry: HistoryEntry;
  children: HistoryEntry[];
  isLast?: boolean;
  depth?: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onTogglePin: () => void;
  onReplay?: () => void;
}

/**
 * Renders a single history entry as a tree node.
 * Parent nodes can be expanded to show child requests (sampling/elicitation).
 */
export function HistoryTreeNode({
  entry,
  children,
  isLast: _isLast = true,
  depth = 0,
  expanded,
  onToggleExpand,
  onTogglePin,
  onReplay,
}: HistoryTreeNodeProps) {
  // isLast is used for connector styling at parent level (reserved for future use)
  void _isLast;
  const [childrenVisible, setChildrenVisible] = useState(true);
  const hasChildren = children.length > 0;
  const isChild = depth > 0;

  const toggleChildren = () => {
    setChildrenVisible((prev) => !prev);
  };

  // Format timestamp
  const timestamp = new Date(entry.timestamp).toLocaleTimeString();

  return (
    <Box>
      {/* Main entry row */}
      <Card
        withBorder
        style={
          entry.pinned
            ? { borderColor: 'var(--mantine-color-yellow-5)', borderWidth: 1 }
            : undefined
        }
      >
        <Stack gap="sm" p="md">
          {/* Header row */}
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              {/* Expand/collapse toggle for parent nodes */}
              {hasChildren && (
                <Button
                  variant="subtle"
                  size="xs"
                  p={0}
                  w={20}
                  h={20}
                  onClick={toggleChildren}
                >
                  {childrenVisible ? (
                    <IconChevronDown size={14} />
                  ) : (
                    <IconChevronRight size={14} />
                  )}
                </Button>
              )}
              {!hasChildren && !isChild && <Box w={20} />}

              {entry.pinned && <Text c="yellow">*</Text>}

              <Text size="sm" c="dimmed" ff="monospace">
                {timestamp}
              </Text>

              <Badge variant="light" size="sm">
                {entry.method}
              </Badge>

              {entry.target && (
                <Text size="sm" fw={500}>
                  {entry.target}
                </Text>
              )}

              {/* Relative time for child requests */}
              {isChild && entry.relativeTime !== undefined && (
                <Badge variant="outline" size="xs" color="gray">
                  {formatRelativeTime(entry.relativeTime)}
                </Badge>
              )}
            </Group>

            <Group gap="sm" wrap="nowrap">
              <Badge color={entry.success ? 'green' : 'red'} size="sm">
                {entry.success ? 'OK' : 'Error'}
              </Badge>
              <Text size="sm" c="dimmed">
                {entry.duration}ms
              </Text>
            </Group>
          </Group>

          {/* Parameters (always visible if present, for parent nodes) */}
          {!isChild && entry.params && Object.keys(entry.params).length > 0 && (
            <Text size="sm">
              <Text span c="dimmed">
                Parameters:{' '}
              </Text>
              <Code>{JSON.stringify(entry.params)}</Code>
            </Text>
          )}

          {/* Child request summary */}
          {isChild && (
            <Text size="sm" c="dimmed">
              {getChildSummary(entry)}
            </Text>
          )}

          {/* Response preview for child requests */}
          {isChild && getResponsePreview(entry) && (
            <Text size="sm" c="dimmed" fs="italic">
              Response: "{getResponsePreview(entry)}"
            </Text>
          )}

          {/* Metadata row: SSE ID, Progress Token (parent only) */}
          {!isChild && (entry.sseId || entry.progressToken) && (
            <Group gap="lg">
              {entry.sseId && (
                <Text size="xs" c="dimmed">
                  SSE ID: <Code>{entry.sseId}</Code>
                </Text>
              )}
              {entry.progressToken && (
                <Text size="xs" c="dimmed">
                  Progress Token: <Code>{entry.progressToken}</Code>
                </Text>
              )}
            </Group>
          )}

          {/* Expandable response section */}
          <Collapse in={expanded}>
            {entry.response && (
              <Stack
                gap="xs"
                pt="sm"
                style={{ borderTop: '1px solid var(--mantine-color-dark-4)' }}
              >
                <Text size="sm" c="dimmed">
                  Response:
                </Text>
                <Code block style={{ maxHeight: 192, overflow: 'auto' }}>
                  {JSON.stringify(entry.response, null, 2)}
                </Code>
              </Stack>
            )}
          </Collapse>

          {/* Actions row */}
          <Group justify="space-between" pt="xs">
            <Group gap="xs">
              <Button variant="subtle" size="xs" onClick={onReplay}>
                Replay
              </Button>
              {!isChild && (
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={onTogglePin}
                  leftSection={
                    entry.pinned ? (
                      <IconPinnedOff size={14} />
                    ) : (
                      <IconPin size={14} />
                    )
                  }
                >
                  {entry.pinned ? 'Unpin' : 'Pin'}
                </Button>
              )}
            </Group>
            {entry.response && (
              <Button
                variant="subtle"
                size="xs"
                onClick={onToggleExpand}
                leftSection={
                  expanded ? (
                    <IconChevronDown size={14} />
                  ) : (
                    <IconChevronRight size={14} />
                  )
                }
              >
                {expanded ? 'Collapse' : 'Expand'}
              </Button>
            )}
          </Group>
        </Stack>
      </Card>

      {/* Child requests with tree connectors */}
      {hasChildren && (
        <Collapse in={childrenVisible}>
          <Box pl={24} pt={4}>
            {children.map((child, index) => (
              <ChildRequestRow
                key={child.id}
                entry={child}
                isLast={index === children.length - 1}
              />
            ))}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

interface ChildRequestRowProps {
  entry: HistoryEntry;
  isLast: boolean;
}

/**
 * Renders a child request with tree connector lines.
 */
function ChildRequestRow({
  entry,
  isLast,
}: ChildRequestRowProps) {
  const [showDetails, setShowDetails] = useState(false);
  const timestamp = new Date(entry.timestamp).toLocaleTimeString();

  return (
    <Box style={{ position: 'relative' }}>
      {/* Tree connector line */}
      <Box
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: isLast ? '50%' : 0,
          width: 16,
          borderLeft: '1px solid var(--mantine-color-dark-4)',
        }}
      />
      <Box
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          width: 16,
          borderTop: '1px solid var(--mantine-color-dark-4)',
        }}
      />

      {/* Child content */}
      <Box pl={24} py={4}>
        <Card withBorder p="sm">
          <Stack gap="xs">
            {/* Header row */}
            <Group justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap">
                <Text size="sm" c="dimmed" ff="monospace">
                  {timestamp}
                </Text>

                <Badge variant="light" size="sm" color="violet">
                  {entry.method}
                </Badge>

                {entry.relativeTime !== undefined && (
                  <Badge variant="outline" size="xs" color="gray">
                    {formatRelativeTime(entry.relativeTime)}
                  </Badge>
                )}
              </Group>

              <Group gap="sm" wrap="nowrap">
                <Badge color={entry.success ? 'green' : 'red'} size="xs">
                  {entry.success ? 'OK' : 'Error'}
                </Badge>
                <Text size="xs" c="dimmed">
                  {entry.duration}ms
                </Text>
              </Group>
            </Group>

            {/* Summary */}
            <Text size="sm" c="dimmed">
              {getChildSummary(entry)}
            </Text>

            {/* Response preview */}
            {getResponsePreview(entry) && (
              <Text size="sm" c="dimmed" fs="italic">
                Response: "{getResponsePreview(entry)}"
              </Text>
            )}

            {/* Expandable full response */}
            <Collapse in={showDetails}>
              {entry.response && (
                <Stack
                  gap="xs"
                  pt="sm"
                  style={{ borderTop: '1px solid var(--mantine-color-dark-4)' }}
                >
                  <Text size="xs" c="dimmed">
                    Full Response:
                  </Text>
                  <Code block style={{ maxHeight: 150, overflow: 'auto', fontSize: 11 }}>
                    {JSON.stringify(entry.response, null, 2)}
                  </Code>
                </Stack>
              )}
            </Collapse>

            {/* Expand button */}
            {entry.response && (
              <Group justify="flex-end">
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => setShowDetails((prev) => !prev)}
                >
                  {showDetails ? 'Hide Details' : 'View Details'}
                </Button>
              </Group>
            )}
          </Stack>
        </Card>
      </Box>
    </Box>
  );
}
