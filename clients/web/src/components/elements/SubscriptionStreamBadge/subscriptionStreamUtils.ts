import type { ResourceSubscriptionStreamStatus } from "../../../../../../core/mcp/types.js";

export interface StreamPresentation {
  /** Mantine palette color name conveying the status. */
  color: string;
  /** Short label shown on the panel badge. */
  label: string;
  /** Full explanation shown in the tooltip (both variants). */
  tooltip: string;
}

const STREAM_INTRO =
  "On modern (2026-07-28) servers, resource subscriptions are a filter over one long-lived subscriptions/listen stream.";

// Keyed by status so it's exhaustive at compile time: a new
// `ResourceSubscriptionStreamStatus` that isn't handled here is a type error
// (no unreachable `default` needed, so it stays fully covered).
const PRESENTATION: Record<
  ResourceSubscriptionStreamStatus,
  StreamPresentation
> = {
  acknowledged: {
    color: "green",
    label: "Listening",
    tooltip: `${STREAM_INTRO} The server acknowledged the subscription and the stream is open, carrying resources/updated notifications.`,
  },
  reconnecting: {
    color: "yellow",
    label: "Reconnecting…",
    tooltip: `${STREAM_INTRO} The stream dropped unexpectedly; re-listening to re-establish it (there is no resumability, so the full filter is re-sent).`,
  },
  ended: {
    color: "gray",
    label: "Stream ended",
    tooltip: `${STREAM_INTRO} The stream is closed and won't reconnect on its own — either the server ended it (for example, on shutdown) or reconnection was abandoned after repeated failures. Re-subscribe to try again.`,
  },
};

/**
 * Maps a modern listen-stream status to its badge color, label, and tooltip
 * copy (#1630). Kept in its own module so the badge component file exports only
 * a component (react-refresh rule).
 */
export function subscriptionStreamPresentation(
  status: ResourceSubscriptionStreamStatus,
): StreamPresentation {
  return PRESENTATION[status];
}
