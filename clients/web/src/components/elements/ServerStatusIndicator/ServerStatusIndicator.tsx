import { Group, Paper, Text } from "@mantine/core";
import type { ConnectionStatus } from "@inspector/core/mcp/types.js";

export interface ServerStatusIndicatorProps {
  status: ConnectionStatus;
  latencyMs?: number;
  retryCount?: number;
}

const statusColorVar: Record<ConnectionStatus, string> = {
  connected: "var(--inspector-status-connected)",
  connecting: "var(--inspector-status-connecting)",
  disconnected: "var(--inspector-status-disconnected)",
  error: "var(--inspector-status-error)",
};

function getLabel(
  status: ConnectionStatus,
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
    case "error":
      return retryCount != null ? `Error (${retryCount})` : "Error";
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
