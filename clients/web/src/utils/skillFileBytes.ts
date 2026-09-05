/**
 * Decoding a `resources/read` payload back to the bytes its digest was taken
 * over (SEP-2640, #2234).
 *
 * A pure transform with no I/O and no subsystem ownership, so it belongs in
 * `utils/` rather than `lib/` — the screen that verifies a skill file does the
 * fetching; this only turns what came back into bytes.
 */

import { base64ToBytes, textToBytes } from "@inspector/core/mcp/skills.js";

/**
 * The content a `resources/read` returned for one skill file. Either `text` (a
 * `TextResourceContents`) or `blob` (base64, a `BlobResourceContents`).
 */
export interface SkillFileContents {
  text?: string;
  blob?: string;
  mimeType?: string;
}

/**
 * The raw bytes of a skill file, as fetched.
 *
 * Throws for a result carrying neither `text` nor `blob`. That is a server bug,
 * and it must not be quietly treated as empty content: an empty `Uint8Array`
 * has a perfectly good SHA-256, so a silent fallback would report a *digest
 * mismatch* — a confident, wrong diagnosis — instead of "this response carried
 * no content at all". Callers surface the throw as a per-file read failure.
 */
export function skillFileBytes(contents: SkillFileContents): Uint8Array {
  if (typeof contents.text === "string") return textToBytes(contents.text);
  if (typeof contents.blob === "string") return base64ToBytes(contents.blob);
  throw new Error("resources/read returned neither text nor blob content.");
}
