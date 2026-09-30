/**
 * Bounded line layout for an HTTP request/response body shown in the TUI.
 *
 * Ink renders each body line as its own `<Box>`, so an uncapped body — a large
 * file listing, an embedded resource, a big search result — became thousands
 * of components in one render pass and could freeze the terminal (#2407). This
 * caps both the line count and each line's length: a pretty-printed embedded
 * resource is typically a single enormous base64 line, which a line cap alone
 * does nothing about. What was cut is reported rather than dropped silently,
 * so a truncated body never reads as the whole payload.
 *
 * Pure by design (utils = compute): the component that renders the result is
 * `components/BodyLines.tsx`.
 */

/** Most body lines rendered before the rest are summarized. */
export const MAX_BODY_LINES = 500;

/** Longest single line rendered before its tail is summarized. */
export const MAX_BODY_LINE_CHARS = 2000;

export interface BodyLayout {
  /** The lines to render, each already clipped to `maxLineChars`. */
  lines: string[];
  /** Lines of the formatted body not included in `lines`. */
  hiddenLines: number;
  /** Line count of the full formatted body. */
  totalLines: number;
}

/** Pretty-prints `body` when it parses as JSON; otherwise returns it as is. */
export function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/** Clips `line` to `maxChars`, noting how many characters were cut. */
export function clipLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  return `${line.slice(0, maxChars)}… (+${line.length - maxChars} chars)`;
}

/** Formats `body` and bounds it to at most `maxLines` lines of `maxLineChars`. */
export function layoutBody(
  body: string,
  maxLines: number = MAX_BODY_LINES,
  maxLineChars: number = MAX_BODY_LINE_CHARS,
): BodyLayout {
  const all = formatBody(body).split("\n");
  return {
    lines: all.slice(0, maxLines).map((line) => clipLine(line, maxLineChars)),
    hiddenLines: Math.max(all.length - maxLines, 0),
    totalLines: all.length,
  };
}
