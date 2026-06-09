import { arrayMove } from "@dnd-kit/sortable";

/**
 * Pure reorder: move `activeId` to where `overId` sits in `ids`. Returns the
 * input array unchanged (referential identity preserved) when either id is
 * missing or they're identical, so a no-movement drop is a no-op. Extracted
 * from `ServerListScreen` for direct unit testing — the `@dnd-kit`
 * keyboard/pointer sensors don't produce measurable layout rects under
 * happy-dom, so the full gesture is exercised in the Storybook play (real
 * browser) while this keeps the ordering math verifiable in the unit suite.
 */
export function reorderIds(
  ids: string[],
  activeId: string,
  overId: string,
): string[] {
  if (activeId === overId) return ids;
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1) return ids;
  return arrayMove(ids, from, to);
}
