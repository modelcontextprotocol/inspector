/**
 * Browser-side helpers for triggering file downloads from in-memory content.
 *
 * Centralized so the temp-anchor incantation (`appendChild` for Firefox,
 * deferred `revokeObjectURL` so the scheduled download can read the blob)
 * lives in one place — and so the wiring is unit-testable under happy-dom
 * without dragging React along.
 */

/**
 * Download an in-memory {@link Blob} as `filename`. Uses a temporary anchor
 * element to trigger the browser's save dialog. The append-to-body step is
 * for older Firefox versions that wouldn't fire `click()` on a detached
 * anchor; modern browsers don't require it but it stays as the safe path.
 *
 * The object-URL revoke is deferred to a task: `link.click()` only schedules
 * the download, and revoking the URL synchronously can abort it before the
 * browser reads the blob (Firefox/Safari, intermittently Chrome for larger
 * blobs).
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Download an in-memory JSON string as `filename`. */
export function downloadJsonFile(filename: string, json: string): void {
  downloadBlob(filename, new Blob([json], { type: "application/json" }));
}

/**
 * Derive a safe suggested filename from a resource URI: the last path segment,
 * stripped of control/format characters, path separators, and characters
 * disallowed in filenames on common platforms. Falls back to `"download"` when
 * nothing usable remains.
 */
export function fileNameFromUri(uri: string): string {
  /* v8 ignore next -- String.prototype.split always returns a non-empty array, so .pop() is never undefined; the `?? ""` fallback is unreachable. */
  const tail = uri.split(/[\\/]/).pop() ?? "";
  const safe = tail
    .replace(/[\p{Cc}\p{Cf}]+/gu, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  return safe.length > 0 ? safe.slice(0, 255) : "download";
}

/**
 * Parse `url` and return it only if its scheme is `http:` or `https:`;
 * otherwise null. Shared http(s)-only allowlist for opening or downloading
 * server-supplied URLs.
 */
export function isHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * The categories of in-memory data the Inspector can export. Tightening
 * `kind` to this union catches typos at call sites and documents the
 * stable on-disk filename prefix.
 */
export type ExportKind =
  | "history"
  | "history-pinned"
  | "history-unpinned"
  | "logs"
  | "network"
  | "console";

/**
 * Build a sortable export filename in the shape
 * `inspector-<kind>-<server-id>-<ISO timestamp>.json`. The timestamp uses
 * the standard ISO-8601 form with `:` swapped for `-` so the result is
 * safe on Windows (which disallows `:` in filenames). Server id is
 * passed through `encodeURIComponent` for the same reason — config ids
 * are user-supplied and may contain slashes / spaces / colons.
 *
 * When `serverId` is falsy (undefined or empty) the segment is omitted;
 * the rest of the filename still uniquely identifies the export by kind
 * + time.
 */
export function buildExportFilename(
  kind: ExportKind,
  serverId: string | undefined,
  now: Date = new Date(),
): string {
  const iso = now.toISOString().replace(/:/g, "-");
  const id = serverId ? encodeURIComponent(serverId) : undefined;
  const segments = ["inspector", kind, ...(id ? [id] : []), iso];
  return `${segments.join("-")}.json`;
}
