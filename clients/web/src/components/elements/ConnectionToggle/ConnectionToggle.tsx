import { Switch } from "@mantine/core";
import type { ConnectionStatus } from "@inspector/core/mcp/types.js";

export interface ConnectionToggleProps {
  status: ConnectionStatus;
  disabled?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function ConnectionToggle({
  status,
  disabled = false,
  onConnect,
  onDisconnect,
}: ConnectionToggleProps) {
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <Switch
      size="lg"
      checked={isConnected || isConnecting}
      disabled={disabled || isConnecting}
      onChange={(event) => {
        if (event.currentTarget.checked) {
          onConnect();
        } else {
          onDisconnect();
        }
      }}
    />
  );
}
