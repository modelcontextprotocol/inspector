import { Badge, Tooltip } from "@mantine/core";
import type { ResourceSubscriptionStreamStatus } from "../../../../../../core/mcp/types.js";
import { subscriptionStreamPresentation } from "./subscriptionStreamUtils";

export interface SubscriptionStreamBadgeProps {
  /** Lifecycle status of the modern `subscriptions/listen` stream. */
  status: ResourceSubscriptionStreamStatus;
}

/**
 * Status indicator for the modern-era resource-subscription listen stream
 * (#1630). Only meaningful on the modern era — the caller gates rendering on
 * `streamState.active`. Renders a labelled dot badge (green/yellow/gray) in the
 * Subscriptions section header, explaining the stream in a tooltip.
 */
export function SubscriptionStreamBadge({
  status,
}: SubscriptionStreamBadgeProps) {
  const { color, label, tooltip } = subscriptionStreamPresentation(status);
  return (
    <Tooltip label={tooltip} multiline w={260} withArrow>
      <Badge variant="dot" color={color}>
        {label}
      </Badge>
    </Tooltip>
  );
}
