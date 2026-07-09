/**
 * Duration (ms) of the monitoring column's open/close slide (#1616). Shared so
 * dependent timings can't silently drift from the animation:
 *   - `InspectorView` drives the column's Mantine `Transition` with it.
 *   - `ServerCard` waits just past it before scrolling a newly-failed card into
 *     view (#1621), so the column's open + the resulting grid reflow settle
 *     before `scrollIntoView` measures the card's position.
 */
export const MONITOR_COLUMN_ANIM_MS = 300;

/**
 * Delay (ms) before scrolling a newly-failed server card into view — the column
 * animation plus a small buffer for the reflow to commit.
 */
export const FAILED_CARD_SCROLL_DELAY_MS = MONITOR_COLUMN_ANIM_MS + 20;
