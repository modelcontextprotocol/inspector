/**
 * Pure helpers backing the per-MIME dispatch in {@link ContentViewer}. Kept in
 * a dependency-free module so they can be unit-tested in isolation and reused by
 * the blob renderers (PDF / CSV / HTML) without dragging in React.
 */

/**
 * The renderer family a MIME type maps to. `ContentViewer` switches on this to
 * pick a branch; `binary` is the catch-all "preview not supported" fallback.
 */
export type MimeKind =
  | "image"
  | "audio"
  | "pdf"
  | "markdown"
  | "json"
  | "xml"
  | "css"
  | "csv"
  | "html"
  | "text"
  | "binary";

/** Strip any `; charset=…` parameters and normalise case for comparison. */
function baseMime(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

/**
 * Classify a MIME type into the renderer family `ContentViewer` should use.
 * Structured-suffix types (`application/foo+json`, `image/svg+xml`) fold into
 * their base family. Unknown `application/*` types fall through to `binary`.
 */
export function getMimeKind(mimeType: string): MimeKind {
  const base = baseMime(mimeType);
  if (base.startsWith("image/")) return "image";
  if (base.startsWith("audio/")) return "audio";
  if (base === "application/pdf") return "pdf";
  if (base === "text/markdown" || base === "text/x-markdown") return "markdown";
  if (base === "application/json" || base.endsWith("+json")) return "json";
  if (base === "text/csv") return "csv";
  if (base === "text/html") return "html";
  if (base === "text/css") return "css";
  if (
    base === "text/xml" ||
    base === "application/xml" ||
    base.endsWith("+xml")
  )
    return "xml";
  if (
    base === "application/javascript" ||
    base === "application/ecmascript" ||
    base === "application/x-javascript"
  )
    return "text";
  if (base.startsWith("text/")) return "text";
  return "binary";
}

/** Renderer families that operate on decoded text rather than raw bytes. */
const TEXTUAL_KINDS: ReadonlySet<MimeKind> = new Set<MimeKind>([
  "markdown",
  "json",
  "xml",
  "css",
  "csv",
  "html",
  "text",
]);

/** Whether a MIME kind is rendered from decoded UTF-8 text. */
export function isTextualKind(kind: MimeKind): boolean {
  return TEXTUAL_KINDS.has(kind);
}

/**
 * Decode a base64 string to UTF-8 text. Used when a server delivers inherently
 * textual content (CSV, XML, HTML, …) as a `BlobResourceContents` blob instead
 * of as `text`.
 */
export function decodeBase64ToUtf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Decode a base64 string to raw bytes. Used to build a `Blob` URL for binary
 * previews (e.g. PDF) without round-tripping through a `data:` URI.
 */
export function decodeBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Pretty-print JSON text; returns the input unchanged when it doesn't parse. */
export function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

/** Heuristic: does this plain text (no MIME) look like a JSON document? */
export function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

/**
 * Indent a single-line or minified XML/HTML-ish document for readability before
 * syntax highlighting. Hand-rolled: split on `>\s*<` boundaries, then track a
 * nesting depth, decrementing on closing tags and incrementing after opening
 * tags that aren't self-closing or a one-line `<a>text</a>` pair.
 */
export function formatXml(xml: string): string {
  const withBreaks = xml.replace(/>\s*</g, ">\n<").trim();
  let depth = 0;
  const out: string[] = [];
  for (const raw of withBreaks.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const isClosing = /^<\//.test(line);
    if (isClosing) depth = Math.max(depth - 1, 0);
    out.push("  ".repeat(depth) + line);
    const isOpening =
      /^<[A-Za-z]/.test(line) && // a tag, not a comment / declaration
      !/\/>$/.test(line) && // not self-closing
      !isClosing && // not a closing tag
      !/^<([A-Za-z][\w-]*)\b[^>]*>.*<\/\1>$/.test(line); // not a one-line pair
    if (isOpening) depth++;
  }
  return out.join("\n");
}

/**
 * Content-Security-Policy applied to previewed HTML resources. `script-src` is
 * deliberately omitted so it falls through to `default-src 'none'` — that's what
 * keeps the policy load-bearing if the iframe `sandbox` is ever loosened to
 * allow scripts. Styles/fonts/images are permitted so reports render, but no
 * navigation, plugins, or form submission.
 */
export const PREVIEW_HTML_CSP =
  "default-src 'none'; " +
  "style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "img-src data: blob:; " +
  "font-src data: https://fonts.gstatic.com; " +
  "base-uri 'none'; " +
  "object-src 'none'; " +
  "form-action 'none';";

const CSP_META_TAG = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_HTML_CSP}">`;

/**
 * Inject the preview CSP `<meta>` into an HTML document before it's served to a
 * sandboxed iframe. Handles three shapes: a full document with a `<head>` (inject
 * at the top of head), a document with `<html>` but no `<head>` (add a head), and
 * a bare fragment (wrap in a minimal document).
 */
export function wrapHtmlWithCsp(html: string): string {
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${CSP_META_TAG}`);
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(
      /<html([^>]*)>/i,
      `<html$1><head>${CSP_META_TAG}</head>`,
    );
  }
  return `<html><head>${CSP_META_TAG}</head><body>${html}</body></html>`;
}

/**
 * Safe-scheme allowlist for markdown anchors. Permits absolute http(s), mailto,
 * in-page fragments, and root-relative paths — but rejects protocol-relative
 * `//evil.com` and dangerous schemes (`javascript:`, `data:`, …) so
 * user-supplied markdown can't smuggle a script-bearing link.
 */
export const SAFE_HREF = /^(https?:|mailto:|#|\/(?!\/))/i;

/** Whether a markdown anchor `href` is safe to render as a real `<a>`. */
export function isSafeHref(href: string | undefined): boolean {
  return typeof href === "string" && SAFE_HREF.test(href);
}
