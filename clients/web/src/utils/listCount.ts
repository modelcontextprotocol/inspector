// How many entries a server list (`tools/list`, `prompts/list`,
// `resources/list`) holds, as the list headers and the Connection Info
// capability rows show it (#2607). Server authors check this against clients
// that cap tools per server, so a partial count must never read as the total:
// in paginated mode with a `nextCursor` still unloaded, the loaded count is
// only a lower bound and is rendered with a trailing `+`.

export interface ListCount {
  /** Entries loaded so far. */
  count: number;
  /** True when the server has more pages that have not been loaded yet. */
  partial: boolean;
}

/**
 * The count of a loaded list, or `undefined` after a failed load — where the
 * empty `items` would otherwise render as a confident `(0)`.
 */
export function listCountOf(list: {
  items: readonly unknown[];
  canLoadMore: boolean;
  error: Error | null;
}): ListCount | undefined {
  if (list.error) return undefined;
  return { count: list.items.length, partial: list.canLoadMore };
}

/** `"15"`, or `"15+"` when more pages remain unloaded. */
export function formatListCount({ count, partial }: ListCount): string {
  return partial ? `${count}+` : String(count);
}

/** `"Tools (15)"` / `"Tools (15+)"`, or just `"Tools"` when there is no count. */
export function formatCountedLabel(
  label: string,
  listCount: ListCount | undefined,
): string {
  return listCount ? `${label} (${formatListCount(listCount)})` : label;
}
