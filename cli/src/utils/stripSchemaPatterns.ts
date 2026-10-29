/**
 * Prepare a server-supplied JSON Schema for validation without evaluating any
 * of its regular expressions.
 *
 * `pattern` and `patternProperties` regexes come from the server, and Ajv
 * runs them on the native backtracking `RegExp` engine: a pattern such as
 * `^(a+)+$` checked against a near-match string takes exponential time and
 * freezes the thread doing the validation. Rather than evaluate them, this
 * returns a COPY of the schema with every regex removed, plus a count, so the
 * caller can say visibly that those checks were skipped. The original schema
 * object is never mutated (the UI displays it).
 *
 * `patternProperties` cannot simply be dropped: under
 * `additionalProperties`, a key that one of its regexes would have matched
 * becomes "additional", so `additionalProperties: false` would start
 * rejecting keys the server declared as allowed — a false failure. Which keys
 * are additional depends on the very regexes we refuse to run, so the honest
 * outcome is to evaluate neither: an object schema with `patternProperties`
 * loses both keywords (its `properties` are still checked), and the skipped
 * regexes are counted.
 */

/** Keywords whose value is a single subschema. */
const SCHEMA_KEYWORDS = [
  "additionalProperties",
  "additionalItems",
  "contains",
  "propertyNames",
  "if",
  "then",
  "else",
  "not",
  "unevaluatedItems",
  "unevaluatedProperties",
];
/** Keywords whose value is an array of subschemas. */
const SCHEMA_ARRAY_KEYWORDS = ["allOf", "anyOf", "oneOf", "prefixItems"];
/** Keywords whose value maps names to subschemas. */
const SCHEMA_MAP_KEYWORDS = [
  "properties",
  "$defs",
  "definitions",
  "dependentSchemas",
  "dependencies",
];

export type StrippedSchema = {
  /** A copy of the schema with no regexes left in it. */
  schema: unknown;
  /** How many regexes were removed. */
  stripped: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stripSchemaPatterns(schema: unknown): StrippedSchema {
  let stripped = 0;

  const walk = (node: unknown): unknown => {
    if (!isObject(node)) return node; // `true` / `false` schemas, or junk
    const copy: Record<string, unknown> = { ...node };
    if (typeof copy.pattern === "string") {
      delete copy.pattern;
      stripped++;
    }
    if (isObject(copy.patternProperties)) {
      stripped += Object.keys(copy.patternProperties).length;
      delete copy.patternProperties;
      // See the header: without the regexes, which keys are "additional"
      // is unknowable, so this constraint is skipped too.
      delete copy.additionalProperties;
    }
    for (const key of SCHEMA_KEYWORDS) {
      if (key in copy) copy[key] = walk(copy[key]);
    }
    for (const key of SCHEMA_ARRAY_KEYWORDS) {
      const value = copy[key];
      if (Array.isArray(value)) copy[key] = value.map(walk);
    }
    for (const key of SCHEMA_MAP_KEYWORDS) {
      const value = copy[key];
      if (isObject(value)) {
        copy[key] = Object.fromEntries(
          // `dependencies` may map to a string array (property dependency);
          // `walk` returns non-objects unchanged.
          Object.entries(value).map(([name, sub]) => [name, walk(sub)]),
        );
      }
    }
    // `items` is either one subschema or (draft-07 tuple form) an array.
    if (Array.isArray(copy.items)) copy.items = copy.items.map(walk);
    else if ("items" in copy) copy.items = walk(copy.items);
    return copy;
  };

  return { schema: walk(schema), stripped };
}

/** The user-facing note for a schema that had regexes removed. */
export function patternsNotEvaluatedNote(stripped: number): string {
  return `${stripped} regex pattern(s) in this schema were not evaluated`;
}
