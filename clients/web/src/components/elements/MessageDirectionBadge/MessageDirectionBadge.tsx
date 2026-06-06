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
 * Dual-state badge showing which way a History/Network entry traveled. Outgoing
 * (client → server) is green; incoming (client ← server) is yellow, so the two
 * are distinguishable at a glance. Shared by `HistoryEntry` and `NetworkEntry`.
 */
export function MessageDirectionBadge({
  direction,
}: MessageDirectionBadgeProps) {
  return (
    <Badge
      color={direction === "outgoing" ? "green" : "yellow"}
      variant="light"
    >
      {LABEL[direction]}
    </Badge>
  );
}
