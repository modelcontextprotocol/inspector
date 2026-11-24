import { describe, it, expect } from "vitest";
import type { EventSubscriptionStatus } from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { EventSubscriptionStatusBadge } from "./EventSubscriptionStatusBadge";

describe("EventSubscriptionStatusBadge", () => {
  const statuses: EventSubscriptionStatus[] = [
    "starting",
    "active",
    "reconnecting",
    "terminated",
    "stopped",
  ];

  it.each(statuses)("renders %s", (status) => {
    renderWithMantine(<EventSubscriptionStatusBadge status={status} />);
    expect(screen.getByText(status)).toBeInTheDocument();
  });
});
