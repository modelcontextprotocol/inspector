import { Badge } from "@mantine/core";

export interface MessageDirectionBadgeProps {
  /**
   * Direction of travel for the entry: "outgoing" = the inspector sent it to
   * the server (client → server); "incoming" = the server sent it to the
   * inspector (server → client).
   */
  direction: "outgoing" | "incoming";
}

const LABEL: Record<MessageDirectionBadgeProps["direction"], string> = {
  outgoing: "client → server",
  incoming: "server → client",
};

const BG: Record<MessageDirectionBadgeProps["direction"], string> = {
  outgoing: "var(--inspector-badge-outgoing-bg)",
  incoming: "var(--inspector-badge-incoming-bg)",
};

const FG: Record<MessageDirectionBadgeProps["direction"], string> = {
  outgoing: "var(--inspector-badge-outgoing-fg)",
  incoming: "var(--inspector-badge-incoming-fg)",
};

/**
 * Dual-state badge showing which way a Protocol/Network entry traveled. Outgoing
 * (client → server) is green; incoming (server → client) is purple — not yellow,
 * which (paired with green) reads as caution/ok status rather than direction.
 * Surfaces come from `--inspector-badge-*` tokens: a tinted fill in light mode,
 * a deep saturated fill with light text in dark mode. Shared by `ProtocolEntry`
 * and `NetworkEntry`.
 */
export function MessageDirectionBadge({
  direction,
}: MessageDirectionBadgeProps) {
  return (
    <Badge autoContrast={false} bg={BG[direction]} c={FG[direction]}>
      {LABEL[direction]}
    </Badge>
  );
}
