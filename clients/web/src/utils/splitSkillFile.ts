/**
 * Split a skill file into its YAML frontmatter and its body (#2263).
 *
 * A pure transform with no I/O and no subsystem of its own, so it lives in
 * `utils/` rather than `lib/` — and in its own module rather than in
 * `SkillsScreen.tsx`, because a component file that also exports a function
 * defeats React Fast Refresh (`react-refresh/only-export-components`).
 */

export interface SkillFileParts {
  /**
   * The raw YAML between the fences, fences excluded — `undefined` when the
   * file has no frontmatter at all. Raw rather than parsed: this app carries no
   * YAML parser, and showing the bytes the server actually served is the more
   * useful answer for a conformance tool anyway.
   */
  frontmatter?: string;
  /** Everything after the closing fence, or the whole file when there is none. */
  body: string;
}

/**
 * Separate a leading YAML frontmatter fence from the rest of a skill file.
 *
 * The Skills screen renders the two halves in different places — the
 * frontmatter in its own collapsible section, the body in the file viewer — and
 * deriving both from **one** split is what stops them disagreeing: the section
 * can never show one file's frontmatter while the viewer shows another's, and a
 * file with no frontmatter cannot leave a stale section on screen.
 *
 * It also matters for rendering: the markdown renderer has no frontmatter
 * support, so an un-split `---\nname: …\n---` is read as a setext heading and
 * painted as a title above the document's real one.
 *
 * Two deliberate conservatisms, because this must never eat content:
 *
 *   - Only a fence at the very **start** of the file counts. A `---` anywhere
 *     else is a horizontal rule and is left in the body.
 *   - A file that opens with `---` but never closes the fence is **not**
 *     frontmatter; the whole file is returned as the body rather than being
 *     truncated to nothing.
 */
export function splitSkillFile(text: string): SkillFileParts {
  if (!/^---[ \t]*\r?\n/.test(text)) return { body: text };
  const rest = text.slice(text.indexOf("\n") + 1);
  const close = rest.search(/^---[ \t]*\r?$/m);
  if (close === -1) return { body: text };
  const frontmatter = rest.slice(0, close).replace(/\r?\n$/, "");
  const after = rest.slice(close);
  const newline = after.indexOf("\n");
  if (newline === -1) return { frontmatter, body: "" };
  // Drop the blank line conventionally left between the fence and the body, so
  // the document does not open with dead space.
  return { frontmatter, body: after.slice(newline + 1).replace(/^\r?\n/, "") };
}
