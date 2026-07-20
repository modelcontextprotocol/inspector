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

/**
 * Maps a modern listen-stream status to its badge color, label, and tooltip
 * copy (#1630). Kept in its own module so the badge component file exports only
 * a component (react-refresh rule).
 */
export function subscriptionStreamPresentation(
  status: ResourceSubscriptionStreamStatus,
): StreamPresentation {
  switch (status) {
    case "acknowledged":
      return {
        color: "green",
        label: "Listening",
        tooltip: `${STREAM_INTRO} The server acknowledged the subscription and the stream is open, carrying resources/updated notifications.`,
      };
    case "reconnecting":
      return {
        color: "yellow",
        label: "Reconnecting…",
        tooltip: `${STREAM_INTRO} The stream dropped unexpectedly; re-listening to re-establish it (there is no resumability, so the full filter is re-sent).`,
      };
    case "ended":
      return {
        color: "gray",
        label: "Stream ended",
        tooltip: `${STREAM_INTRO} The server ended the stream deliberately (for example, on shutdown); it will not reconnect on its own.`,
      };
  }
}
