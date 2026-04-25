import { Group, Paper, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
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
  const showLabel = useMediaQuery("(min-width: 1200px)");
  const label = getLabel(status, latencyMs, retryCount);
  return (
    <Group gap="xs">
      <Dot
        bg={statusColorVar[status]}
        className={status === "connecting" ? "inspector-pulse" : undefined}
        title={showLabel ? undefined : label}
      />
      {showLabel && <Text size="sm">{label}</Text>}
    </Group>
  );
}
