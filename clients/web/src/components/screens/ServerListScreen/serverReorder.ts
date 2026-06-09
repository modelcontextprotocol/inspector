import type { Announcements, DragEndEvent } from "@dnd-kit/core";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import { reorderIds } from "./reorderIds";

/**
 * Reorder glue for `ServerListScreen`, extracted from the component so the
 * announcement copy and the drag-end resolution are unit-testable directly.
 * The `@dnd-kit` keyboard/pointer sensors don't yield measurable layout rects
 * under happy-dom, so the live gesture can't be driven in the unit suite (it's
 * covered by the Storybook play instead) — keeping this logic out of the
 * component body is what lets it stay verified.
 */

/** Display name for an id, falling back to the id when it isn't found. */
function nameFor(servers: ServerEntry[], id: string): string {
  return servers.find((s) => s.id === id)?.name ?? id;
}

/** 1-based position of an id in the list, for "position 3 of 7" narration. */
function positionFor(servers: ServerEntry[], id: string): number {
  return servers.findIndex((s) => s.id === id) + 1;
}

/**
 * Live-region narration so keyboard / screen-reader users hear the pick-up,
 * each move, and the drop. Fed to `DndContext`'s `accessibility.announcements`,
 * which writes into dnd-kit's built-in `aria-live` region.
 */
export function buildReorderAnnouncements(
  servers: ServerEntry[],
): Announcements {
  const count = servers.length;
  return {
    onDragStart: ({ active }) =>
      `Picked up server ${nameFor(servers, String(active.id))}. It is in position ${positionFor(
        servers,
        String(active.id),
      )} of ${count}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `Server ${nameFor(servers, String(active.id))} moved to position ${positionFor(
            servers,
            String(over.id),
          )} of ${count}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `Server ${nameFor(servers, String(active.id))} dropped at position ${positionFor(
            servers,
            String(over.id),
          )} of ${count}.`
        : `Server ${nameFor(servers, String(active.id))} dropped.`,
    onDragCancel: ({ active }) =>
      `Reorder cancelled. Server ${nameFor(servers, String(active.id))} returned to its original position.`,
  };
}

/**
 * Build the `DndContext.onDragEnd` handler bound to the current list and the
 * persistence callback. Returns a no-op-on-no-movement handler: when the drop
 * lands outside any target, on itself, or doesn't change the order, `onReorder`
 * is not called.
 */
export function makeServerDragEndHandler(
  servers: ServerEntry[],
  onReorder: ((orderedIds: string[]) => void) | undefined,
): (event: DragEndEvent) => void {
  return ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return;
    const ids = servers.map((s) => s.id);
    const next = reorderIds(ids, String(active.id), String(over.id));
    if (next !== ids) onReorder?.(next);
  };
}
