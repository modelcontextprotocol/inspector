import {
  Badge,
  Button,
  Card,
  Code,
  Collapse,
  Group,
  Stack,
  Text,
} from "@mantine/core";

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
  children?: HistoryChildEntry[];
  isPinned: boolean;
  pinLabel?: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onReplay: () => void;
  onTogglePin: () => void;
}

export function HistoryEntry({
  timestamp,
  method,
  target,
  status,
  durationMs,
  parameters,
  response,
  children,
  isPinned,
  pinLabel,
  isExpanded,
  onToggleExpand,
  onReplay,
  onTogglePin,
}: HistoryEntryProps) {
  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm">
            <Text size="sm" c="dimmed" ff="monospace">
              {timestamp}
            </Text>
            <Badge color="dark">{method}</Badge>
            {target && (
              <Text size="sm" fw={500}>
                {target}
              </Text>
            )}
          </Group>
          <Group gap="sm">
            <Badge color={status === "success" ? "green" : "red"}>
              {status === "success" ? "OK" : "Error"}
            </Badge>
            <Text size="sm" c="dimmed">
              {durationMs}ms
            </Text>
          </Group>
        </Group>

        <Group gap="xs">
          <Button variant="subtle" size="xs" onClick={onReplay}>
            Replay
          </Button>
          <Button variant="subtle" size="xs" onClick={onTogglePin}>
            {isPinned ? "Unpin" : "Pin"}
            {isPinned && pinLabel ? ` (${pinLabel})` : ""}
          </Button>
          <Button variant="subtle" size="xs" onClick={onToggleExpand} ml="auto">
            {isExpanded ? "Collapse" : "Expand"}
          </Button>
        </Group>

        <Collapse in={isExpanded}>
          <Stack gap="sm">
            {parameters && (
              <Stack gap="xs">
                <Text size="sm">Parameters:</Text>
                <Code block>{JSON.stringify(parameters, null, 2)}</Code>
              </Stack>
            )}
            {response && (
              <Stack gap="xs">
                <Text size="sm">Response:</Text>
                <Code block>{JSON.stringify(response, null, 2)}</Code>
              </Stack>
            )}
            {children && children.length > 0 && (
              <Stack gap="xs">
                {children.map((child, index) => (
                  <Group key={index} pl="lg" gap="sm">
                    <Text size="sm" c="dimmed" ff="monospace">
                      +--{" "}
                    </Text>
                    <Text size="sm" c="dimmed" ff="monospace">
                      {child.timestamp}
                    </Text>
                    <Badge color="dark" size="sm">
                      {child.method}
                    </Badge>
                    {child.target && <Text size="sm">{child.target}</Text>}
                    <Badge
                      color={child.status === "success" ? "green" : "red"}
                      size="sm"
                    >
                      {child.status === "success" ? "OK" : "Error"}
                    </Badge>
                    <Text size="sm" c="dimmed">
                      {child.durationMs}ms
                    </Text>
                  </Group>
                ))}
              </Stack>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </Card>
  );
}
