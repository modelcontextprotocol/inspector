/**
 * Browser-side helpers for triggering file downloads from in-memory content.
 *
 * Centralized so the temp-anchor incantation (`appendChild` for Firefox,
 * try/finally to keep cleanup bulletproof, `revokeObjectURL` to release the
 * object URL) lives in one place — and so the wiring is unit-testable
 * under happy-dom without dragging React along.
 */

/**
 * Download an in-memory string as a JSON file. Uses a temporary anchor
 * element to trigger the browser's save dialog. The append-to-body step is
 * for older Firefox versions that wouldn't fire `click()` on a detached
 * anchor; modern browsers don't require it but it stays as the safe path.
 *
 * The cleanup (removeChild + revokeObjectURL) runs in a `finally` so even
 * a thrown `click()` doesn't leak the DOM node or the object URL.
 */
export function downloadJsonFile(filename: string, json: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }
}

/**
 * Build a sortable export filename in the shape
 * `inspector-<kind>-<server-id>-<ISO timestamp>.json`. The timestamp uses
 * the standard ISO-8601 form with `:` swapped for `-` so the result is
 * safe on Windows (which disallows `:` in filenames). Server id is
 * passed through `encodeURIComponent` for the same reason — config ids
 * are user-supplied and may contain slashes / spaces / colons.
 *
 * When `serverId` is undefined the segment is omitted; the rest of the
 * filename still uniquely identifies the export by kind + time.
 */
export function buildExportFilename(
  kind: string,
  serverId: string | undefined,
  now: Date = new Date(),
): string {
  const iso = now.toISOString().replace(/:/g, "-");
  const id = serverId ? encodeURIComponent(serverId) : undefined;
  const segments = ["inspector", kind, ...(id ? [id] : []), iso];
  return `${segments.join("-")}.json`;
}
