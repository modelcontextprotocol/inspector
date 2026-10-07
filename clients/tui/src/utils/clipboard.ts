// Getting a value out of the TUI and onto the user's clipboard (#2421).
//
// The web client copies through the browser Clipboard API (`CopyButton`). A
// terminal app has no such API, and the obvious substitutes — shelling out to
// `pbcopy` / `xclip` / `clip.exe` — write to the clipboard of the machine the
// *process* runs on, which over SSH is the remote host rather than the machine
// the user is sitting at. OSC 52 is the escape sequence that asks the
// *terminal emulator* to set its clipboard, so it reaches the local clipboard
// through any number of SSH hops; that is why it is the mechanism here and why
// no clipboard package is needed.
//
// It is fire-and-forget: the terminal sends no acknowledgement, so a terminal
// that ignores OSC 52 (or caps its payload size) fails silently. The fallback
// for that case is `writeCopyFile`, which saves the raw value to a private temp
// file whose path the TUI then shows — readable with `cat` or `scp` from
// anywhere, and not bounded by the terminal's line width or scrollback.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Encoded payload size above which a copy is flagged as "large". Several
 * terminals cap or drop OSC 52 payloads around this size (hterm's default is
 * 100,000 bytes; others are lower), so the status line suggests the file
 * fallback rather than letting a truncated paste go unexplained.
 */
export const OSC52_LARGE_PAYLOAD_BYTES = 100_000;

/** The text to copy for a value: strings verbatim, anything else as JSON. */
export function toCopyText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    // JSON.stringify returns undefined for undefined / functions / symbols.
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    // A cycle or a BigInt: still give the user something rather than nothing.
    return String(value);
  }
}

/**
 * The OSC 52 "set clipboard" sequence for `text`, terminated with BEL (the
 * terminator the widest set of terminals accepts). `c` selects the clipboard
 * rather than the primary selection.
 */
export function buildOsc52Sequence(text: string): string {
  const encoded = Buffer.from(text, "utf8").toString("base64");
  return `\u001b]52;c;${encoded}\u0007`;
}

export interface Osc52CopyResult {
  /** Characters in the copied text. */
  chars: number;
  /** Bytes of base64 payload sent to the terminal. */
  payloadBytes: number;
  /** True when the payload exceeds {@link OSC52_LARGE_PAYLOAD_BYTES}. */
  large: boolean;
}

/** The slice of a writable stream `copyViaOsc52` needs. */
export interface EscapeSink {
  write(chunk: string): unknown;
}

/**
 * Emit `text` to the terminal as an OSC 52 clipboard write.
 *
 * Written straight to the stream rather than through Ink's `write`, which
 * would erase and redraw the frame around it: the sequence has no visible
 * output and moves no cursor, so it can go out between frames untouched.
 */
export function copyViaOsc52(text: string, sink: EscapeSink): Osc52CopyResult {
  const sequence = buildOsc52Sequence(text);
  sink.write(sequence);
  // Everything but the payload is fixed framing (ESC ] 5 2 ; c ; … BEL), and
  // base64 is ASCII, so string length is byte length.
  const payloadBytes = sequence.length - buildOsc52Sequence("").length;
  return {
    chars: text.length,
    payloadBytes,
    large: payloadBytes > OSC52_LARGE_PAYLOAD_BYTES,
  };
}

/**
 * Save `text` to a fresh, owner-only temp file and return its path — the
 * fallback for a terminal that ignores OSC 52. The directory is created with
 * `mkdtemp` (mode 0700) and the file with mode 0600, because the value may be
 * a bearer token.
 */
export function writeCopyFile(
  text: string,
  baseDir: string = os.tmpdir(),
): string {
  const dir = fs.mkdtempSync(path.join(baseDir, "mcp-inspector-copy-"));
  const file = path.join(dir, "value.txt");
  fs.writeFileSync(file, text, { encoding: "utf8", mode: 0o600 });
  return file;
}
