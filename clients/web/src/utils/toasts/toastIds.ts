// Toast ids that aren't owned by a feature-specific formatter module. The
// progress and task ids live beside their message formatters in
// `progressToasts.ts` / `taskToasts.ts`; these two have no formatter of their
// own, so they land here.

// Stable toast id for the "response body dropped" warning, keyed per server so
// a request storm updates one persistent toast rather than stacking thousands
// (the drop event can fire rapidly). Mirrors the progress-toast dedupe pattern.
export function bodyDroppedToastId(serverId: string): string {
  return `fetch-body-dropped-${serverId}`;
}

export const CLIENT_CONFIG_LOAD_ERROR_NOTIFICATION_ID =
  "client-config-load-error";
