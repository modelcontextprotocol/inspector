/**
 * Tool-schema portability lint (#1005).
 *
 * A tool's `inputSchema`/`outputSchema` can be a perfectly legal JSON Schema
 * and still be rejected outright by the client the server is actually meant to
 * run against. The reported case is Go's `jsonschema` package emitting a bare
 * `true` for an `interface{}` field: valid Draft 2020-12, accepted by the MCP
 * SDK's own parser, and refused by Claude Code with a bare `"Invalid input"`
 * pointing at `["tools", 7, "outputSchema", "properties", "data"]`. The
 * Inspector is where a server author looks *first*, so a construct that will
 * fail downstream should be named here rather than silently passed through.
 *
 * This is deliberately **not** a JSON Schema validator, for a measured reason:
 * a census of 617 public servers (14,804 tool schemas) reported on the issue
 * found **0** that fail the SDK's own `ListToolsResultSchema.safeParse` — so a
 * conformance check would report nothing on essentially every real server.
 * What bites instead is the narrower subset each consumer accepts, which is
 * what the rules below encode. Every rule is a construct that is legal JSON
 * Schema and is known to be refused or quietly mishandled by real MCP clients.
 *
 * Kept pure and dependency-free so all three clients share one verdict: the
 * CLI's `--strict` report, the TUI's tool detail pane, and the web Tools tab
 * must not disagree about whether a schema is portable.
 */

import type { Tool } from "@modelcontextprotocol/client";

/** Which of a tool's two schemas a finding was raised against. */
export type SchemaKind = "inputSchema" | "outputSchema";

/**
 * `error` — the construct is refused by at least one shipping MCP client, so
 * the tool is unusable there. `warning` — accepted unevenly, or degraded
 * (silently coerced, ignored) rather than rejected.
 */
export type SchemaLintSeverity = "error" | "warning";

/** Stable identifier for a lint rule, so a caller can filter or suppress. */
export type SchemaLintRule =
  | "boolean-schema"
  | "type-union"
  | "untyped-schema"
  | "remote-ref";

/** One problem found at one location in one schema. */
export interface SchemaFinding {
  rule: SchemaLintRule;
  severity: SchemaLintSeverity;
  /** Which schema the finding is in. */
  schema: SchemaKind;
  /**
   * Location within that schema, in the dotted/bracketed form the report
   * prints — `properties.data`, `anyOf[1].items`. Empty string means the
   * schema root.
   */
  path: string;
  /** What is wrong, phrased for a server author. */
  issue: string;
  /** A concrete replacement, not a restatement of the problem. */
  suggestion: string;
}

/** Every finding raised against one tool, in walk order. */
export interface ToolSchemaFindings {
  toolName: string;
  findings: SchemaFinding[];
}

/**
 * Keywords whose value is a schema *or* a boolean by design. `true`/`false`
 * here is the idiomatic spelling ("allow anything else" / "allow nothing
 * else") and every client understands it, so the boolean-schema rule must not
 * fire on them — the issue's own suggested fix is `additionalProperties: true`.
 */
const BOOLEAN_VALUED_KEYWORDS: ReadonlySet<string> = new Set([
  "additionalProperties",
  "unevaluatedProperties",
  "additionalItems",
  "unevaluatedItems",
]);

/** Keywords whose value is a single subschema. */
const SUBSCHEMA_KEYWORDS = [
  "items",
  "contains",
  "not",
  "propertyNames",
  "if",
  "then",
  "else",
  "additionalProperties",
  "unevaluatedProperties",
  "additionalItems",
  "unevaluatedItems",
  // 2019-09/2020-12: the schema the *decoded* string content must satisfy.
  // A real schema position, so a bare `true` or a remote `$ref` under it is a
  // real finding.
  "contentSchema",
] as const;

/** Keywords whose value is an array of subschemas. */
const SUBSCHEMA_ARRAY_KEYWORDS = [
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
] as const;

/**
 * Keywords whose value is a name → subschema map.
 *
 * `dependencies` is the pre-2019 form and may hold either a subschema or an
 * array of property names; the array case is not a schema position, and the
 * walk skips it because a non-object, non-boolean node is not a schema.
 */
const SUBSCHEMA_MAP_KEYWORDS = [
  "properties",
  "patternProperties",
  "dependentSchemas",
  "dependencies",
  "$defs",
  "definitions",
] as const;

/**
 * Keywords that actually constrain the instance being validated — the
 * assertion and applicator vocabularies, plus reference keywords.
 *
 * This is an **allowlist**, and that direction is load-bearing. JSON Schema
 * ignores keywords it does not recognize, so a schema is unconstrained unless
 * something it carries is known to constrain: a denylist of known-annotation
 * keywords would let `{"vendorHint": true}` — which accepts every value —
 * pass as constrained simply because the keyword is unfamiliar.
 *
 * Two categories are deliberately absent. **Annotations** (`title`,
 * `description`, `default`, `examples`, `deprecated`, `readOnly`,
 * `writeOnly`, `$comment`) assert nothing. So do the **definition-only
 * containers** `$defs` / `definitions` and the identifier keywords `$id`,
 * `$schema`, `$anchor`, `$vocabulary`: they hold or name subschemas for
 * *other* schemas to reference, and constrain the current instance not at all.
 *
 * One category is admitted despite being annotation-only in 2020-12's default
 * vocabulary: `format`, and the three content keywords (`contentMediaType`,
 * `contentEncoding`, `contentSchema`). A schema declaring any of them is
 * plainly an attempt to constrain, and reporting it as accepting anything
 * would be noise rather than a finding an author can act on.
 *
 * Defining the rule this way, rather than as "has no `type`", is also
 * deliberate: `{"properties": {…}}` with no `type` does constrain its input,
 * so calling it unconstrained would be false. The rule fires on `{}`, on
 * annotation-only schemas, and on `$defs`-only schemas — the object-literal
 * spellings of the same "any" that a bare `true` expresses.
 */
const CONSTRAINING_KEYWORDS: ReadonlySet<string> = new Set([
  // Assertions
  "type",
  "enum",
  "const",
  "multipleOf",
  "maximum",
  "exclusiveMaximum",
  "minimum",
  "exclusiveMinimum",
  "maxLength",
  "minLength",
  "pattern",
  "format",
  "contentMediaType",
  "contentEncoding",
  "contentSchema",
  "maxItems",
  "minItems",
  "uniqueItems",
  "maxContains",
  "minContains",
  "maxProperties",
  "minProperties",
  "required",
  "dependentRequired",
  // Applicators
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  // `if` / `then` / `else` are deliberately absent — they only constrain as a
  // PAIR. `if` alone has no assertion effect, and `then` / `else` are ignored
  // without it, so `{"if": {"const": 1}}` accepts every value. The pairing is
  // checked separately in `constrainsInstance`.
  "items",
  "prefixItems",
  "contains",
  "additionalItems",
  "unevaluatedItems",
  "properties",
  "patternProperties",
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "dependentSchemas",
  "dependencies",
  // References
  "$ref",
  "$dynamicRef",
  "$recursiveRef",
]);

/**
 * The seven type names JSON Schema recognizes. A `type` naming anything else
 * is malformed rather than unportable, which this module deliberately does not
 * report — see {@link isPortableTypeUnion}.
 */
const JSON_SCHEMA_TYPES: ReadonlySet<string> = new Set([
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "string",
  "integer",
]);

/**
 * Does this schema constrain the instance at all?
 *
 * Presence of a {@link CONSTRAINING_KEYWORDS} member, plus the one keyword
 * group that cannot be judged by presence alone: `if` asserts nothing without
 * a `then` or an `else`, and either of those is ignored without an `if`. So
 * `{"if": {"const": 1}}` and `{"then": {"type": "string"}}` both accept every
 * value, and counting the keyword's mere presence would let them pass as
 * constrained.
 */
function constrainsInstance(node: SchemaRecord): boolean {
  if (Object.keys(node).some((key) => CONSTRAINING_KEYWORDS.has(key))) {
    return true;
  }
  return "if" in node && ("then" in node || "else" in node);
}

/**
 * Is an array-valued `type` the *legal* union this rule is about?
 *
 * The rule reports a construct that is valid JSON Schema and unportable, and
 * its message says exactly that — so it must not fire on an array that is
 * simply malformed (`[]`, which matches nothing; `[3]`; `["bananas"]`;
 * `["string", "string"]`). Saying "this is legal JSON Schema, but…" of those
 * would be false, and the `anyOf` replacement it suggests would be invalid
 * too. Malformed schemas are the SDK parser's business, the same way a
 * non-object, non-boolean node is; this module stays quiet on them.
 */
function isPortableTypeUnion(type: readonly unknown[]): type is string[] {
  if (type.length === 0) return false;
  if (!type.every((t) => typeof t === "string" && JSON_SCHEMA_TYPES.has(t))) {
    return false;
  }
  return new Set(type).size === type.length;
}

/**
 * Depth cap for the walk. A `$ref`-free JSON document cannot be cyclic, but
 * this module is handed whatever a server sent, so bound the recursion rather
 * than trusting it.
 */
const MAX_DEPTH = 64;

type SchemaRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SchemaRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Append a key to a path, quoting it when it is not a bare identifier so the
 * printed path stays unambiguous for an odd property name.
 */
function childPath(parent: string, key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
    return parent === "" ? key : `${parent}.${key}`;
  }
  return `${parent}[${JSON.stringify(key)}]`;
}

function indexPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

/** Human label for a path, so the root reads as something rather than blank. */
export function describeSchemaPath(schema: SchemaKind, path: string): string {
  return path === "" ? schema : `${schema}.${path}`;
}

interface WalkContext {
  schema: SchemaKind;
  findings: SchemaFinding[];
  /**
   * Whether this schema document declares an `$id` anywhere — see
   * {@link declaresAnyId}. Suppresses the `remote-ref` rule.
   */
  hasEmbeddedIds: boolean;
}

/**
 * Does the document declare an `$id` anywhere in it?
 *
 * `$id` establishes a base URI, which changes what "points outside this
 * document" means: with a root `$id: "https://example.com/root"`, the `$ref`
 * `"https://example.com/root#/$defs/x"` resolves to *this* document and needs
 * no fetch at all. Classifying refs correctly in that case means full RFC 3986
 * base-URI resolution against possibly-nested embedded resources, which this
 * module does not do — so when any `$id` is present it declines to classify
 * rather than risk a wrong finding with wrong remediation on a valid schema.
 *
 * A missed finding is the acceptable direction here, the same trade the walk
 * makes on a malformed `type` array. `$id` is vanishingly rare in a tool
 * schema, so this costs almost nothing in practice. If it ever matters, the
 * refinement is to resolve each `$ref` against the enclosing base and compare
 * with the declared ids — not to drop the guard.
 *
 * Descends through {@link forEachSubschema} — **subschema positions only**.
 * A scan over every object value would also reach instance data, where an
 * `$id` key declares nothing: `examples: [{"$id": "payload-field"}]` would
 * otherwise switch this rule off for the entire document.
 */
function declaresAnyId(node: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || !isRecord(node)) return false;
  if (typeof node.$id === "string" && node.$id !== "") return true;
  let found = false;
  forEachSubschema(node, "", (child) => {
    if (!found) found = declaresAnyId(child, depth + 1);
  });
  return found;
}

function add(
  ctx: WalkContext,
  rule: SchemaLintRule,
  severity: SchemaLintSeverity,
  path: string,
  issue: string,
  suggestion: string,
): void {
  ctx.findings.push({
    rule,
    severity,
    schema: ctx.schema,
    path,
    issue,
    suggestion,
  });
}

/**
 * Call `visit` once for every position under `node` that JSON Schema treats as
 * a **subschema** — and only those.
 *
 * The single traversal both {@link walk} and {@link declaresAnyId} run on, so
 * the two cannot disagree about what counts as a schema. That matters more
 * than the deduplication: an independent scan that descended through *every*
 * object value would also reach instance data — `examples: [{"$id": "x"}]`,
 * a `default`, a `const` — where `$id` is just a payload key and declares no
 * embedded resource. Reading one there would suppress `remote-ref` for the
 * whole document.
 */
function forEachSubschema(
  node: SchemaRecord,
  path: string,
  visit: (child: unknown, childPath: string, keyword: string) => void,
): void {
  for (const key of SUBSCHEMA_MAP_KEYWORDS) {
    const map = node[key];
    if (!isRecord(map)) continue;
    for (const [name, sub] of Object.entries(map)) {
      visit(sub, childPath(childPath(path, key), name), key);
    }
  }

  for (const key of SUBSCHEMA_ARRAY_KEYWORDS) {
    const arr = node[key];
    if (!Array.isArray(arr)) continue;
    arr.forEach((sub, i) => {
      visit(sub, indexPath(childPath(path, key), i), key);
    });
  }

  for (const key of SUBSCHEMA_KEYWORDS) {
    if (!(key in node)) continue;
    const value = node[key];
    // Draft-04 tuple form: `items` may be an array of schemas.
    if (key === "items" && Array.isArray(value)) {
      value.forEach((sub, i) => {
        visit(sub, indexPath(childPath(path, key), i), key);
      });
      continue;
    }
    visit(value, childPath(path, key), key);
  }
}

/**
 * What to replace a bare `true` with — which depends on the keyword above it.
 *
 * `{}` and `true` are the same schema, so `{}` is always the *exact* rewrite.
 * It is normally not what to advise, because `{}` is the very shape
 * `untyped-schema` flags — hence the usual advice to declare a real type.
 *
 * Under `not` that reverses. `{"not": true}` rejects every value; swapping in
 * `{"type": "object", …}` leaves the parent rejecting only objects, so every
 * non-object now passes — the enclosing contract is **widened**, not narrowed.
 * `{}` is exempt from `untyped-schema` in that position for the same reason,
 * so it is both exact and safe to recommend there.
 *
 * Everywhere else the replacement is described as a deliberate *change* rather
 * than a narrowing: in an ordinary property position it does narrow, but under
 * a conditional (`if`) it redirects which branch applies, and a suggestion has
 * no business claiming an effect it cannot guarantee.
 */
function booleanTrueSuggestion(keyword: string | undefined): string {
  if (keyword === "not") {
    return "Use `{}`, the object form of the always-true schema — under `not` that is an exact replacement. (Declaring a concrete type here would instead let every value of another type through.)";
  }
  return 'Declare what the value actually is — e.g. `{"type": "object", "additionalProperties": true}` for a free-form object. That is a deliberate change of contract, not an equivalent rewrite: `true` accepts any JSON value at all.';
}

/**
 * Visit one schema position. `keyword` is the parent keyword this node sits
 * under (undefined at the root), which is what decides whether a bare boolean
 * is idiomatic here or a portability defect.
 */
function walk(
  node: unknown,
  path: string,
  keyword: string | undefined,
  depth: number,
  ctx: WalkContext,
): void {
  if (depth > MAX_DEPTH) return;

  if (typeof node === "boolean") {
    if (keyword !== undefined && BOOLEAN_VALUED_KEYWORDS.has(keyword)) return;
    add(
      ctx,
      "boolean-schema",
      "error",
      path,
      `Bare \`${String(node)}\` used where a schema object is expected.`,
      node
        ? booleanTrueSuggestion(keyword)
        : // `false` in a property position means the property is FORBIDDEN.
          // Deleting the entry is not the same thing: with `additionalProperties`
          // absent (default `true`) the property becomes allowed with any value,
          // so the suggestion has to preserve the always-false constraint.
          'Use the object form of the always-false schema — `{"not": {}}`. (Deleting the entry is a different contract: under the default `additionalProperties` the property would then be allowed with any value, not forbidden.)',
    );
    return;
  }

  // Anything that is neither a boolean nor an object is not a schema at all.
  // That is malformed rather than merely unportable, and the SDK's own parser
  // is the right place to reject it, so this lint stays quiet and stops here.
  if (!isRecord(node)) return;

  lintNode(node, path, keyword, ctx);

  forEachSubschema(node, path, (child, childPathValue, childKeyword) => {
    walk(child, childPathValue, childKeyword, depth + 1, ctx);
  });
}

/** Rules that apply to a single schema object, ignoring its children. */
function lintNode(
  node: SchemaRecord,
  path: string,
  keyword: string | undefined,
  ctx: WalkContext,
): void {
  const type = node.type;

  if (Array.isArray(type) && isPortableTypeUnion(type)) {
    // The suggestion is always `anyOf`, never "drop it from `required`".
    // Accepting an explicit JSON `null` and permitting the property to be
    // absent are independent: on a required `["null","boolean"]` field,
    // un-requiring it would both stop accepting `null` and start accepting
    // omission — a different contract, not the same one spelled portably.
    // `anyOf` branches each carrying a single `type` are equivalent, and this
    // lint treats them as portable.
    add(
      ctx,
      "type-union",
      "warning",
      path,
      `\`type\` is an array (${JSON.stringify(type)}). The array form is legal JSON Schema, but several MCP clients read \`type\` as a single string and either reject the tool or drop the constraint.`,
      `Split it into \`anyOf\` branches, each with a single \`type\` — \`{"anyOf": [${type
        .map((t) => `{"type": "${t}"}`)
        .join(
          ", ",
        )}]}\`. (Making the property optional instead is a different contract: absent is not the same as \`null\`.)`,
    );
  }

  const ref = node.$ref;
  if (
    typeof ref === "string" &&
    ref !== "" &&
    !ref.startsWith("#") &&
    !ctx.hasEmbeddedIds
  ) {
    add(
      ctx,
      "remote-ref",
      "warning",
      path,
      `\`$ref\` points outside this document (\`${ref}\`). Clients do not fetch remote schemas, so the constraint is dropped or the tool is rejected.`,
      "Inline the referenced schema, or move it into `$defs` and reference it as `#/$defs/<name>`.",
    );
  }

  const constrains = constrainsInstance(node);
  // Under `not`, an always-accepting subschema is the idiomatic spelling of
  // always-*reject* — `{"not": {}}` is the object form of `false`, and the one
  // this module's own `boolean-schema` suggestion recommends. Reporting it as
  // "accepts any value" would be the exact opposite of what it does, so the
  // rule stops at that position rather than contradicting itself.
  if (!constrains && keyword !== "not") {
    add(
      ctx,
      "untyped-schema",
      "warning",
      path,
      "Schema carries no validation keyword at all, so it accepts any value — the object-literal spelling of a bare `true`.",
      // "changes", not "narrows": in an ordinary property position it does
      // narrow, but under a conditional (`if`) a typed replacement redirects
      // which branch applies rather than tightening anything.
      'Declare what the value actually is — e.g. `{"type": "object", "additionalProperties": true}` for a free-form object. That is a deliberate change of contract, which is the point: as written it constrains nothing.',
    );
  }
}

/**
 * Lint one of a tool's schemas.
 *
 * There is deliberately **no root-level "inputSchema must be an object" rule**,
 * even though MCP does require that. The SDK's `ToolSchema` types `inputSchema`
 * with `type: literal("object")`, so a tool whose input root is anything else
 * fails `ListToolsResultSchema.safeParse`; `salvageListItems` then drops it
 * before `ManagedToolsState` hands the list to anyone. Verified against a live
 * server advertising `inputSchema: {type: "array"}` — `listAllTools()` returns
 * an empty array, so no client can ever pass such a tool to this module.
 *
 * A rule that cannot fire is worse than no rule: it makes the documentation
 * claim a check the tool does not perform. The condition is already reported
 * through the salvage path's malformed-items surface, which is where a dropped
 * tool legitimately belongs.
 */
function lintSchema(
  schema: unknown,
  kind: SchemaKind,
  findings: SchemaFinding[],
): void {
  walk(schema, "", undefined, 0, {
    schema: kind,
    findings,
    hasEmbeddedIds: declaresAnyId(schema),
  });
}

/**
 * Lint both of a tool's schemas. Returns findings in walk order — inputSchema
 * first, then outputSchema — so a report reads top-down through the tool.
 */
export function lintToolSchemas(tool: Tool): SchemaFinding[] {
  const findings: SchemaFinding[] = [];
  if (tool.inputSchema !== undefined) {
    lintSchema(tool.inputSchema, "inputSchema", findings);
  }
  if (tool.outputSchema !== undefined) {
    lintSchema(tool.outputSchema, "outputSchema", findings);
  }
  return findings;
}

/** Lint a tool list, dropping the tools that came back clean. */
export function lintTools(tools: readonly Tool[]): ToolSchemaFindings[] {
  const results: ToolSchemaFindings[] = [];
  for (const tool of tools) {
    const findings = lintToolSchemas(tool);
    if (findings.length > 0) results.push({ toolName: tool.name, findings });
  }
  return results;
}

/** Count findings by severity across a lint result. */
export function countFindings(results: readonly ToolSchemaFindings[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const { findings } of results) {
    for (const f of findings) {
      if (f.severity === "error") errors++;
      else warnings++;
    }
  }
  return { errors, warnings };
}

/** `2 errors` / `1 warning` — one pluralized count, used in every surface. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * One-line summary of a lint result, shared by the CLI's non-strict hint, the
 * TUI's tools header and the web Tools tab so the three cannot disagree.
 */
export function summarizeFindings(
  results: readonly ToolSchemaFindings[],
): string {
  const { errors, warnings } = countFindings(results);
  return `${plural(errors, "error")}, ${plural(warnings, "warning")} across ${plural(results.length, "tool")}`;
}

/**
 * Severity breakdown for ONE tool's findings — "1 error, 3 warnings".
 *
 * Deliberately not "N errors" keyed off the highest severity present: a tool
 * with one error and three warnings is four findings, not four errors, and
 * labelling the total with the worst severity misreports every mixed result.
 * Categories that are empty are omitted, so a warning-only tool reads "3
 * warnings" rather than "0 errors, 3 warnings".
 */
export function summarizeToolFindings(
  findings: readonly SchemaFinding[],
): string {
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  const parts: string[] = [];
  if (errors > 0) parts.push(plural(errors, "error"));
  if (warnings > 0) parts.push(plural(warnings, "warning"));
  return parts.join(", ");
}

/**
 * Render a lint result as plain text — the CLI's `--strict` report, and the
 * body the TUI's detail pane prints. Shared so the two cannot describe the
 * same finding differently.
 */
export function formatSchemaLintReport(
  results: readonly ToolSchemaFindings[],
): string {
  const lines: string[] = [];
  for (const { toolName, findings } of results) {
    for (const f of findings) {
      lines.push(
        `${f.severity === "error" ? "Error" : "Warning"}: tool "${toolName}"`,
      );
      lines.push(`  Path: ${describeSchemaPath(f.schema, f.path)}`);
      lines.push(`  Issue: ${f.issue}`);
      lines.push(`  Suggestion: ${f.suggestion}`);
      lines.push("");
    }
  }
  lines.push(`${summarizeFindings(results)}.`);
  return lines.join("\n");
}
