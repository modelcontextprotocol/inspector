/**
 * Terminal-output sanitization for server-controlled text (security).
 *
 * Every string a server sends (tool results, descriptions, resource text,
 * elicitation messages, URIs) reaches the user's terminal through the human
 * formatter. Raw C0/C1 control bytes in that text are attacker-controlled
 * terminal commands: OSC 52 writes the clipboard, OSC 0 spoofs the window
 * title, CSI moves/erases earlier output, and a BEL/ESC inside a URI breaks
 * out of an OSC 8 hyperlink wrapper. `--format json` is safe (JSON escapes
 * them); this module makes `--format text` safe by replacing every control
 * character except `\n` and `\t` with a visible stand-in before any styling
 * (so the CLI's own ANSI styling, added afterwards, is unaffected).
 *
 * Replacements: C0 → Unicode Control Pictures (␀…␟, e.g. ESC → ␛),
 * DEL → ␡, C1 (0x80–0x9F, includes 8-bit CSI/OSC) → ␡-style `\u{9b}` text.
 */

const CONTROL_CHARS =
  // C0 minus \t (0x09) and \n (0x0A), plus DEL and the C1 range.
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

function visibleControl(ch: string): string {
  const code = ch.codePointAt(0)!;
  if (code <= 0x1f) return String.fromCodePoint(0x2400 + code);
  if (code === 0x7f) return "\u2421"; // ␡
  return `\\u{${code.toString(16)}}`; // C1: no control picture exists
}

/** Replace terminal control characters (except `\n`/`\t`) with visible text. */
export function sanitizeText(value: string): string {
  return value.replace(CONTROL_CHARS, visibleControl);
}

/**
 * Deep-sanitize every string in a payload (values AND object keys) ahead of
 * human formatting. Input is JSON-shaped data (daemon responses are
 * JSON-parsed), so plain objects/arrays/primitives are the whole universe.
 */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === "string") return sanitizeText(value) as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[sanitizeText(k)] = sanitizeDeep(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Schemes a server-supplied URI may be rendered as an OSC 8 hyperlink.
 * A hyperlink is an invitation for the user to invoke the local handler for
 * the scheme, so an untrusted MCP server only gets the web ones: `file:`,
 * custom protocol handlers, `javascript:` and the rest render as plain text.
 */
const SAFE_LINK_SCHEMES = new Set(["https:", "http:"]);

/** True when `uri` parses and its scheme is on the OSC 8 allowlist. */
export function isSafeLinkTarget(uri: string): boolean {
  try {
    return SAFE_LINK_SCHEMES.has(new URL(uri).protocol);
  } catch {
    return false;
  }
}
