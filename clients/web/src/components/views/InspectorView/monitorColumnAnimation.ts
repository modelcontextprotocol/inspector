/**
 * Duration (ms) of the monitoring sidebar's open/close slide (#1616). Shared so
 * dependent timings can't silently drift from the animation:
 *   - `InspectorView` drives the column's Mantine `Transition` with it.
 *   - `ServerCard` waits just past it before scrolling a newly-failed (#1621) or
 *     newly-connected (#1682) card into view, so the column's open + the
 *     resulting grid reflow settle before `scrollIntoView` measures the card.
 */
export const MONITOR_COLUMN_ANIM_MS = 300;

/**
 * Delay (ms) before scrolling a just-failed or just-connected server card into
 * view — the column animation plus a small buffer for the reflow to commit.
 * The sidebar auto-opens on both transitions, so both scrolls wait for it.
 */
export const CARD_SCROLL_DELAY_MS = MONITOR_COLUMN_ANIM_MS + 20;
