import { Group, Paper, Text } from "@mantine/core";

export interface ServerStatusIndicatorProps {
  status: "connected" | "connecting" | "disconnected" | "failed";
  latencyMs?: number;
  retryCount?: number;
}

const statusColorVar: Record<ServerStatusIndicatorProps["status"], string> = {
  connected: "var(--inspector-status-connected)",
  connecting: "var(--inspector-status-connecting)",
  disconnected: "var(--inspector-status-disconnected)",
  failed: "var(--inspector-status-failed)",
};

function getLabel(
  status: ServerStatusIndicatorProps["status"],
  latencyMs?: number,
  retryCount?: number,
): string {
  switch (status) {
    case "connected":
      return latencyMs != null ? `Connected (${latencyMs}ms)` : "Connected";
    case "connecting":
      return "Connecting...";
    case "disconnected":
      return "Disconnected";
    case "failed":
      return retryCount != null ? `Failed (${retryCount})` : "Failed";
  }
}

const Dot = Paper.withProps({
  w: 10,
  h: 10,
  radius: "xl",
});

export function ServerStatusIndicator({
  status,
  latencyMs,
  retryCount,
}: ServerStatusIndicatorProps) {
  return (
    <Group gap="xs">
      <Dot
        bg={statusColorVar[status]}
        className={status === "connecting" ? "inspector-pulse" : undefined}
      />
      <Text size="sm">{getLabel(status, latencyMs, retryCount)}</Text>
    </Group>
  );
}
