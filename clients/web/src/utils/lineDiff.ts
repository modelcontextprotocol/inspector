/**
 * A small line diff for comparing two tool runs (#2830). The inputs are
 * pretty-printed JSON, so a line diff over a canonical (key-sorted) rendering
 * reads as a structural diff without pulling a diff library into the bundle.
 *
 * Longest-common-subsequence over the lines that remain once the common prefix
 * and suffix are trimmed. The table is quadratic in that middle, so it is
 * bounded: past {@link MAX_DIFF_CELLS} the diff reports itself as too large
 * rather than stalling the tab.
 */

export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

/** Upper bound on the LCS table (rows × columns of the untrimmed middle). */
export const MAX_DIFF_CELLS = 4_000_000;

/** Object keys in sorted order at every depth, so key order never reads as a change. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Pretty-printed JSON with sorted keys. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

/**
 * Line diff of `before` → `after`, in display order. Returns `null` when the
 * changed region is too large to diff within {@link MAX_DIFF_CELLS}.
 */
export function diffLines(
  before: string,
  after: string,
  maxCells: number = MAX_DIFF_CELLS,
): DiffLine[] | null {
  const a = before.split("\n");
  const b = after.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const rows = endA - start;
  const cols = endB - start;
  if (rows * cols > maxCells) return null;

  // lcs[i * (cols + 1) + j] = LCS length of a[start+i..endA) and b[start+j..endB).
  const width = cols + 1;
  const lcs = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[start + i] === b[start + j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const out: DiffLine[] = [];
  for (let k = 0; k < start; k++) out.push({ kind: "same", text: a[k] });
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (a[start + i] === b[start + j]) {
      out.push({ kind: "same", text: a[start + i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      out.push({ kind: "removed", text: a[start + i] });
      i++;
    } else {
      out.push({ kind: "added", text: b[start + j] });
      j++;
    }
  }
  for (; i < rows; i++) out.push({ kind: "removed", text: a[start + i] });
  for (; j < cols; j++) out.push({ kind: "added", text: b[start + j] });
  for (let k = endA; k < a.length; k++) out.push({ kind: "same", text: a[k] });
  return out;
}
