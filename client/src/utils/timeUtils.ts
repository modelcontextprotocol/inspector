/**
 * Format a duration in milliseconds to a human-readable string.
 * Examples: "245ms", "2.4s", "1m 30s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  if (ms < 60000) {
    const seconds = ms / 1000;
    // Show one decimal place for values under 10s
    if (seconds < 10) {
      return `${seconds.toFixed(1)}s`;
    }
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);

  if (seconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
}

/**
 * Format an ISO timestamp to a time-only string (e.g., "2:34:56 PM").
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString();
}

/**
 * Format an ISO timestamp to a full date/time string (e.g., "1/15/2026, 2:34:56 PM").
 */
export function formatTimestampFull(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}
