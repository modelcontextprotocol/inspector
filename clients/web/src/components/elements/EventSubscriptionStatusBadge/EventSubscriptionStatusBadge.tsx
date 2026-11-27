import { Badge } from "@mantine/core";
import type { EventSubscriptionStatus } from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import { filledBadgeColor } from "../filledBadgeColor";

export interface EventSubscriptionStatusBadgeProps {
  status: EventSubscriptionStatus;
}

const statusColor: Record<EventSubscriptionStatus, string> = {
  starting: "blue",
  active: "green",
  reconnecting: "yellow",
  terminated: "red",
  stopped: "gray",
};

const FilledBadge = Badge.withProps({
  variant: "filled",
  autoContrast: true,
});

/**
 * The state of one Events subscription (SEP-3415, #3030): starting, active,
 * reconnecting, terminated by the server, or stopped by the user. The
 * TaskStatusBadge treatment, so the two read alike.
 */
export function EventSubscriptionStatusBadge({
  status,
}: EventSubscriptionStatusBadgeProps) {
  return (
    <FilledBadge color={filledBadgeColor(statusColor[status])}>
      {status}
    </FilledBadge>
  );
}
