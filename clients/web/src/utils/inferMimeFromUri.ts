/**
 * Infer a resource's MIME type from its URI suffix.
 *
 * A pure lookup with no I/O, so it lives in `utils/`. Extracted from
 * `ResourcePreviewPanel` in #2263 when the Skills screen needed the same
 * inference: both panels decide which renderer to engage for a resource whose
 * server omitted `mimeType`, and two copies of this table would drift.
 */

// Map a file extension to the MIME type that drives ContentViewer's per-MIME
// renderer dispatch. MCP servers commonly omit `mimeType` (or return a generic
// `text/plain` / `application/octet-stream`), so the URI suffix is the most
// reliable signal for engaging the markdown / PDF / CSV / XML / HTML / CSS
// renderers. Order doesn't matter — suffixes are unique.
const URI_SUFFIX_MIME: ReadonlyArray<readonly [string, string]> = [
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".csv", "text/csv"],
  [".json", "application/json"],
  [".xml", "application/xml"],
  [".html", "text/html"],
  [".htm", "text/html"],
  [".css", "text/css"],
  [".pdf", "application/pdf"],
];

/**
 * The MIME type a URI's file extension implies, or `undefined` for an
 * unrecognised suffix so callers can fall through to their own default.
 */
export function inferMimeFromUri(uri: string): string | undefined {
  const path = uri.split("?")[0].split("#")[0];
  const lower = path.toLowerCase();
  for (const [suffix, mime] of URI_SUFFIX_MIME) {
    if (lower.endsWith(suffix)) return mime;
  }
  return undefined;
}

/** Whether an effective MIME type is Markdown, which is the only form that
 *  carries YAML frontmatter worth splitting off (#2263). */
export function isMarkdownMime(mime: string | undefined): boolean {
  return mime === "text/markdown" || mime === "text/x-markdown";
}
