import { Switch } from "@mantine/core";
import type { ConnectionStatus } from "@inspector/core/mcp/types.js";

export interface ConnectionToggleProps {
  status: ConnectionStatus;
  disabled?: boolean;
  onToggle: () => void;
}

export function ConnectionToggle({
  status,
  disabled = false,
  onToggle,
}: ConnectionToggleProps) {
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <Switch
      size="lg"
      checked={isConnected || isConnecting}
      disabled={disabled || isConnecting}
      onChange={onToggle}
    />
  );
}
