import { Switch } from "@mantine/core";
import type { ConnectionStatus } from "@inspector/core/mcp/types.js";

export interface ConnectionToggleProps {
  status: ConnectionStatus;
  disabled?: boolean;
  onToggle: () => void;
  /**
   * Accessible name for the switch (it renders no visible label). Callers pass
   * a server-specific label, e.g. `Connect or disconnect "Alpha"`; defaults to
   * a generic label so the control is never unlabeled (WCAG `label`).
   */
  "aria-label"?: string;
}

export function ConnectionToggle({
  status,
  disabled = false,
  onToggle,
  "aria-label": ariaLabel = "Toggle server connection",
}: ConnectionToggleProps) {
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <Switch
      size="lg"
      checked={isConnected || isConnecting}
      disabled={disabled || isConnecting}
      onChange={onToggle}
      aria-label={ariaLabel}
    />
  );
}
