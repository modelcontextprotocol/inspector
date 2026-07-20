import { Badge, ThemeIcon, Tooltip } from "@mantine/core";
import type { ResourceSubscriptionStreamStatus } from "../../../../../../core/mcp/types.js";
import { subscriptionStreamPresentation } from "./subscriptionStreamUtils";

export interface SubscriptionStreamBadgeProps {
  /** Lifecycle status of the modern `subscriptions/listen` stream. */
  status: ResourceSubscriptionStreamStatus;
  /**
   * `"badge"` (default) renders a labelled dot badge for the panel; `"dot"`
   * renders a bare colored dot for the accordion header (tooltip only).
   */
  variant?: "badge" | "dot";
}

/**
 * Status indicator for the modern-era resource-subscription listen stream
 * (#1630). Only meaningful on the modern era — the caller gates rendering on
 * `streamState.active`. Renders as a labelled badge in the Subscriptions panel
 * or a bare dot in the accordion header, both explaining the stream in a
 * tooltip.
 */
export function SubscriptionStreamBadge({
  status,
  variant = "badge",
}: SubscriptionStreamBadgeProps) {
  const { color, label, tooltip } = subscriptionStreamPresentation(status);
  if (variant === "dot") {
    return (
      <Tooltip label={tooltip} multiline w={260} withArrow>
        <ThemeIcon
          size={12}
          radius="xl"
          color={color}
          role="img"
          aria-label={`Listen stream: ${label}`}
        />
      </Tooltip>
    );
  }
  return (
    <Tooltip label={tooltip} multiline w={260} withArrow>
      <Badge variant="dot" color={color}>
        {label}
      </Badge>
    </Tooltip>
  );
}
