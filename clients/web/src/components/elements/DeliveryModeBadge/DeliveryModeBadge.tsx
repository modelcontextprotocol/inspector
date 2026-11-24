import { Badge } from "@mantine/core";
import { filledBadgeColor } from "../filledBadgeColor";

export interface DeliveryModeBadgeProps {
  /**
   * A delivery mode from an event type's `delivery` (SEP-3415). A string
   * rather than the three known modes: a server may advertise one this client
   * does not know, and the list still shows it (in gray) rather than hiding it.
   */
  mode: string;
}

const COLOR_BY_MODE: Record<string, string> = {
  poll: "blue",
  push: "teal",
  webhook: "grape",
};

const ModeBadge = Badge.withProps({
  variant: "filled",
  autoContrast: true,
  size: "sm",
  // Mode names are lowercase protocol literals; keep their casing.
  tt: "none",
});

/**
 * Badge naming one Events delivery mode (`poll`, `push`, `webhook`), one
 * distinct color each so an event type's offer reads at a glance in the list.
 * Filled + `autoContrast` like the other semantic badges, for WCAG AA.
 */
export function DeliveryModeBadge({ mode }: DeliveryModeBadgeProps) {
  return (
    <ModeBadge color={filledBadgeColor(COLOR_BY_MODE[mode] ?? "gray")}>
      {mode}
    </ModeBadge>
  );
}
