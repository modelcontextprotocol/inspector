/**
 * The `SKILL.md` file format: splitting a served file into its YAML
 * frontmatter and body, and parsing that frontmatter into comparable JSON.
 *
 * Separate from `skills.ts` so the dependency runs one way. `skills.ts` owns the
 * *checks* and needs both halves of this module; this module knows nothing about
 * findings, severities, or `SkillEntry`, which is what lets it stay a pure text
 * transform with a single import.
 *
 * ⚠️ **This is the one place in `core/` that imports a YAML parser**, and it is
 * imported deliberately rather than hand-rolled. SEP-2640 requires a host to
 * *parse* a `SKILL.md`'s frontmatter and compare it field by field against the
 * entry's — see `checkSkillFrontmatterMatch` — and a regex approximation of YAML
 * would report a conforming server as broken the first time a description
 * carried a colon, a quoted string, or a multi-line block scalar. For a tool
 * whose entire output is "does this server conform", a checker that is itself
 * wrong is worse than no checker. `yaml` was already a repo-root **dependency**
 * (reached from `test-servers/src/load-config.ts`), so this adds no new package
 * to any manifest — but it does newly put `yaml` on `core/`'s runtime import
 * graph, which is why it joins the three bundler `external` lists in the same
 * change (see the dependency-placement rules in AGENTS.md).
 */

import { parse as parseYaml } from "yaml";

export interface SkillFileParts {
  /**
   * The raw YAML between the fences, fences excluded — `undefined` when the
   * file has no frontmatter at all. Kept raw as well as parsed because the two
   * answer different questions: the parsed form is what the conformance check
   * compares, and the bytes are what a reader needs to see when the two
   * disagree.
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

/** Outcome of parsing a frontmatter block. Exactly one member is set. */
export type ParsedFrontmatter =
  | { fields: Record<string, unknown> }
  | { error: string };

/**
 * Parse a frontmatter block into a field map.
 *
 * Two non-obvious decisions:
 *
 *  - **YAML 1.2 core schema**, which is `yaml`'s default and is what the Agent
 *    Skills format assumes. It resolves only JSON's own types, so a timestamp
 *    stays the string the server wrote rather than becoming a `Date` — which
 *    matters because the other side of the comparison arrived over JSON-RPC and
 *    can only ever hold JSON types. Under YAML 1.1 the two would differ for a
 *    date-shaped value that is in fact identical on the wire.
 *  - **A non-mapping is an error, not an empty map.** `---\njust a string\n---`
 *    parses successfully as the scalar `"just a string"`, and reporting that as
 *    "no fields" would present a malformed file as one that merely omitted
 *    everything. An *empty* block (`fields: {}`) is a different fact and is
 *    reported as a successful parse of nothing.
 */
/**
 * Whether a frontmatter block holds anything but whitespace and comments.
 *
 * Comments are stripped only from the start of a line: a `#` inside a value is
 * part of that value, and treating it as a comment would call a block with real
 * content empty. That is the safe direction — mistaking content for emptiness
 * here would turn a malformed document back into "no fields", which is the bug
 * this exists to prevent.
 */
function hasContent(yamlText: string): boolean {
  return yamlText
    .split("\n")
    .some((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
}

/**
 * Depth bound for a parsed frontmatter graph.
 *
 * Generous next to anything a real `SKILL.md` carries — the format's own fields
 * are flat — and far below the stack the comparison walk would need.
 */
const MAX_FRONTMATTER_DEPTH = 64;

/**
 * Why a frontmatter value cannot be compared, or `undefined` when it can.
 *
 * Exported because **both sides need it**. The served side can be cyclic; the
 * listed side arrives over JSON-RPC and cannot be, but it is just as unbounded
 * in DEPTH — a server can advertise a listing nested tens of thousands of
 * levels deep, and the comparison and its message formatter both recurse. A
 * guard on only the YAML side left that door open (Copilot).
 *
 * ⚠️ **A YAML document is a graph, not a tree, and JSON is a tree.** An alias
 * can refer to its own ancestor — `meta: &m [*m]` parses without error into a
 * self-referential array — and the field-by-field comparison is a recursive
 * walk, so such a value crashed `--verify` and the TUI with a stack overflow
 * instead of producing a finding. That is a hostile server taking the tool
 * down, so it is rejected here, at the parse, rather than defended against at
 * every consumer (Copilot).
 *
 * The depth bound closes the same hole by its other door: a legal, acyclic but
 * absurdly nested document would exhaust the stack just as effectively, and a
 * cycle check alone would pass it.
 *
 * Detection is per-PATH, not per-graph: `seen` is added on the way down and
 * removed on the way back up, so a value that merely appears twice as a sibling
 * — which YAML aliases make ordinary and which JSON represents perfectly well —
 * is not mistaken for a cycle.
 */
export function jsonGraphError(
  value: unknown,
  seen: Set<object> = new Set(),
  depth = 0,
): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (depth > MAX_FRONTMATTER_DEPTH) {
    return `Frontmatter nests deeper than ${MAX_FRONTMATTER_DEPTH} levels, which cannot be compared field by field.`;
  }
  const node = value as object;
  if (seen.has(node)) {
    return "Frontmatter contains a cyclic YAML alias, which has no JSON equivalent and cannot be compared against the listing.";
  }
  seen.add(node);
  const members = Array.isArray(node)
    ? (node as unknown[])
    : Object.values(node as Record<string, unknown>);
  for (const member of members) {
    const error = jsonGraphError(member, seen, depth + 1);
    if (error) return error;
  }
  seen.delete(node);
  return undefined;
}

export function parseSkillFrontmatter(yamlText: string): ParsedFrontmatter {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  // An empty (or comment-only) block parses to `null`, and so does an explicit
  // `null` / `~` scalar — but only the first is a degenerate mapping of no
  // fields. The second is a non-mapping document, and returning `{ fields: {} }`
  // for it contradicts this function's own contract (Copilot). They are told
  // apart by the SOURCE, since the parsed value cannot distinguish them.
  if (parsed === null || parsed === undefined) {
    return hasContent(yamlText)
      ? { error: "Frontmatter is not a YAML mapping of fields." }
      : { fields: {} };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      error: "Frontmatter is not a YAML mapping of fields.",
    };
  }
  // Checked BEFORE the value escapes this module, so no consumer has to be
  // cycle-safe on its own.
  const graphError = jsonGraphError(parsed, new Set(), 0);
  if (graphError) return { error: graphError };
  return { fields: parsed as Record<string, unknown> };
}
