import { formatDuration } from "@inspector/core/mcp/connectionDiagnostics.js";

/**
 * How long ago an ISO timestamp was, against a panel's clock, for the Active
 * Sessions list (#2831); `"never"` for a consumer that never attached.
 */
export function sessionAge(iso: string | null, now: number): string {
  if (iso === null) return "never";
  return `${formatDuration(now - Date.parse(iso))} ago`;
}
