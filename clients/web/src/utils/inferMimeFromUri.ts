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
  const lower = decodePercentTriplets(pathOf(uri)).toLowerCase();
  for (const [suffix, mime] of URI_SUFFIX_MIME) {
    if (lower.endsWith(suffix)) return mime;
  }
  return undefined;
}

/**
 * The **path** component of a URI, not the whole string.
 *
 * Stripping only the query and fragment left the authority in, so a host that
 * happened to end in a mapped suffix was read as a filename:
 * `https://documentation.md` has a pathname of `/` and no extension at all, yet
 * matched `.md` and routed a root resource into the markdown renderer.
 *
 * `new URL` handles this for every hierarchical URI including the non-special
 * schemes SEP-2640 allows (`skill://a/SKILL.md` → `/SKILL.md`). It throws on
 * anything it cannot parse — a bare relative name like `notes.md`, say — so
 * that case keeps the old string handling.
 */
function pathOf(uri: string): string {
  try {
    return new URL(uri).pathname;
  } catch {
    return uri.split("?")[0].split("#")[0];
  }
}

/**
 * Percent-decode a path for matching, one escape run at a time.
 *
 * A URI may percent-encode unreserved characters, so `reference%2Emd` names the
 * same file as `reference.md` — and `skillUriIdentity` in `core/mcp/skills.ts`
 * already treats those spellings as equivalent.
 *
 * Decoding the path in one `decodeURIComponent` call was not enough. That
 * throws on a malformed escape (`%zz`) *and* on a syntactically valid octet
 * that is not valid UTF-8 (`%FF`), and a single such octet anywhere in the path
 * then defeated decoding for the whole string — `skill://a/%FF/reference%2Emd`
 * is a perfectly acceptable URI whose `%2E` would never be seen.
 *
 * So each run of escapes is decoded independently, and a run that cannot be
 * decoded as UTF-8 falls back to decoding its **ASCII** octets individually.
 * That is enough for suffix matching, where every character that matters is
 * ASCII, and it leaves a byte it cannot interpret untouched rather than
 * guessing.
 */
function decodePercentTriplets(path: string): string {
  return path.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run.replace(/%([0-9A-Fa-f]{2})/g, (raw, hex: string) => {
        const code = Number.parseInt(hex, 16);
        return code < 0x80 ? String.fromCharCode(code) : raw;
      });
    }
  });
}

/**
 * Types a server sends when it does not really know, or did not bother.
 *
 * `ResourcePreviewPanel` already records the underlying observation — servers
 * "commonly omit `mimeType` (or return a generic `text/plain` /
 * `application/octet-stream`), so the URI suffix is the most reliable signal".
 * Naming them lets a caller act on that: a declared type this generic is weaker
 * evidence than a `.md` suffix, while a specific declared type still wins.
 */
const GENERIC_MIMES = new Set(["text/plain", "application/octet-stream"]);

/**
 * Whether a declared MIME is too generic to outrank a URI suffix.
 *
 * Normalised the same way `isMarkdownMime` is, so `text/plain; charset=utf-8`
 * counts as generic too.
 */
export function isGenericMime(mime: string | undefined): boolean {
  if (mime === undefined) return false;
  return GENERIC_MIMES.has(mime.split(";")[0].trim().toLowerCase());
}

/**
 * Whether an effective MIME type is Markdown — the only form that carries YAML
 * frontmatter worth splitting off (#2263).
 *
 * Normalised before comparing, because a server may answer
 * `text/markdown; charset=utf-8` or `TEXT/MARKDOWN`, and `ContentViewer`
 * accepts both. Comparing the raw string rejected them, which skipped the
 * split: the frontmatter stayed in the rendered document AND the Frontmatter
 * section vanished, for a response that was perfectly valid.
 */
export function isMarkdownMime(mime: string | undefined): boolean {
  if (mime === undefined) return false;
  const base = mime.split(";")[0].trim().toLowerCase();
  return base === "text/markdown" || base === "text/x-markdown";
}
