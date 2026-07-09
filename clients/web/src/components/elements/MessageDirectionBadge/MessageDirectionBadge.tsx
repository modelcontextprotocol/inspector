import { Badge } from "@mantine/core";

export interface MessageDirectionBadgeProps {
  /**
   * Direction of travel for the entry: "outgoing" = the inspector sent it to
   * the server (client → server); "incoming" = the server sent it to the
   * inspector (client ← server).
   */
  direction: "outgoing" | "incoming";
}

const LABEL: Record<MessageDirectionBadgeProps["direction"], string> = {
  outgoing: "client → server",
  incoming: "client ← server",
};

/**
 * Dual-state badge showing which way a Protocol/Network entry traveled. Outgoing
 * (client → server) is green; incoming (client ← server) is purple — not yellow,
 * which (paired with green) reads as caution/ok status rather than direction.
 * Shared by `ProtocolEntry` and `NetworkEntry`.
 */
export function MessageDirectionBadge({
  direction,
}: MessageDirectionBadgeProps) {
  return (
    <Badge
      color={direction === "outgoing" ? "green" : "violet"}
      variant="light"
    >
      {LABEL[direction]}
    </Badge>
  );
}
