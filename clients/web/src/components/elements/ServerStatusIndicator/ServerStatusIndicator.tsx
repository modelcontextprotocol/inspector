import { Group, Paper, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { ConnectionStatus } from "@inspector/core/mcp/types.js";

export interface ServerStatusIndicatorProps {
  status: ConnectionStatus;
  latencyMs?: number;
  retryCount?: number;
  /**
   * True when the server's last connection attempt failed (#1682). The
   * indicator then shows a red dot + "Failed" instead of the settled
   * grey "Disconnected", so a failed connect reads distinctly from a
   * deliberate disconnect. Overrides `status` for the label and color.
   */
  failed?: boolean;
  // Override for the default viewport-based label visibility. Useful when
  // the indicator renders inside a constrained container (sidebar, card)
  // where the global media query doesn't reflect available space.
  showLabel?: boolean;
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
  failed = false,
  showLabel: showLabelProp,
}: ServerStatusIndicatorProps) {
  // Show the text label only above the 1280px app min-width; at/below that floor
  // the header is tight (see ViewHeader's Disconnect collapse), so the indicator
  // drops to a dot-only status with the label moved to its `title` tooltip.
  const wideViewport = useMediaQuery("(min-width: 1281px)");
  const showLabel = showLabelProp ?? wideViewport;
  // A failed connection settles the status back to "disconnected"; the `failed`
  // flag distinguishes it as a failure (red + "Failed") from a deliberate
  // disconnect (grey), overriding the status-derived label and color.
  const label = failed ? "Failed" : getLabel(status, latencyMs, retryCount);
  const color = failed
    ? "var(--inspector-status-error)"
    : statusColorVar[status];
  return (
    <Group gap="xs">
      <Dot
        bg={color}
        className={
          !failed && status === "connecting" ? "inspector-pulse" : undefined
        }
        title={showLabel ? undefined : label}
      />
      {showLabel && <Text size="sm">{label}</Text>}
    </Group>
  );
}
