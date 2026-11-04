/**
 * Prepare a server-supplied JSON Schema for validation without evaluating any
 * of its regular expressions.
 *
 * `pattern` and `patternProperties` regexes come from the server, and Ajv
 * runs them on the native backtracking `RegExp` engine: a pattern such as
 * `^(a+)+$` checked against a near-match string takes exponential time and
 * freezes the thread doing the validation. Rather than evaluate them, this
 * returns a COPY of the schema with every regex removed, plus counts, so the
 * caller can say visibly what was not checked. The original schema object is
 * never mutated (the UI displays it).
 *
 * The rule the transform keeps is: **the result accepts at least everything
 * the original accepts** — it may be less strict, and says so, but it never
 * introduces a false failure. Three things follow from that rule.
 *
 * 1. Only schema positions are rewritten. The walk follows the keywords that
 *    hold subschemas, so a property NAMED `pattern`, or a `pattern` key inside
 *    a `const` / `enum` / `default` value, is data and is left alone.
 *
 * 2. Every `$ref` is re-pointed at a sanitized copy, or removed. Ajv resolves
 *    a JSON pointer to ANY location in the document (`#/default`, say), and
 *    compiles whatever it finds there as a schema — so a reference to a place
 *    the walk did not visit would hand Ajv an unsanitized regex. A `$ref` is
 *    kept only when it is a local `#/...` pointer to a schema position the
 *    walk visited (and the document declares no `$id`, which would move the
 *    base a pointer resolves against); it is then rewritten to that
 *    position's place in the output. Anything else — and every `$dynamicRef`
 *    or `$recursiveRef` — is removed and counted as skipped.
 *
 * 3. Removing a constraint loosens the schema that holds it, and loosening is
 *    only safe in a positive position. Under `not`, inside a `oneOf` branch
 *    (where a looser branch can make two branches match), in an `if`
 *    condition (which decides whether `then` or `else` applies), in
 *    `contains` (bounded by `maxContains`) and beneath `unevaluated*` (whose
 *    verdict depends on what sibling keywords evaluated), a looser subschema
 *    can turn a pass into a failure. So a subschema that lost anything —
 *    directly, or through a child or a `$ref` target — is "tainted", and a
 *    keyword of that kind whose subschema is tainted is removed whole and
 *    counted as skipped. Independent sibling constraints are kept. `allOf`,
 *    `anyOf`, `properties`, `items`, `then` / `else` and the rest only ever
 *    loosen, so they stay.
 *
 * `patternProperties` with at least one key is removed, and so is the
 * `additionalProperties` beside it: without the regexes, which keys are
 * "additional" is unknowable, and `additionalProperties: false` would reject
 * keys the server declared as allowed. An EMPTY `patternProperties` holds no
 * regex, so it and its `additionalProperties` are kept as they are.
 *
 * Nothing that a `$ref` could target is deleted outright: a removed subschema
 * is moved, sanitized, into the root's `definitions` under a generated name
 * (where nothing applies it), and references into it are rewritten there. So
 * the transformed schema always still compiles.
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
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
  "dependencies",
];

/** Prefix of the `definitions` entries removed subschemas are moved to. */
const HOLDING_PREFIX = "__inspector_unevaluated_";

export type StrippedSchema = {
  /** A copy of the schema with no regexes left in it. */
  schema: unknown;
  /** How many regexes were removed. */
  stripped: number;
  /**
   * How many other checks were removed because their verdict depended on a
   * removed regex, or because a `$ref` could not be shown to point at a
   * sanitized subschema.
   */
  skipped: number;
};

type SchemaObject = Record<string, unknown>;
type Path = string[];

function isObject(value: unknown): value is SchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchema(value: unknown): boolean {
  return isObject(value) || typeof value === "boolean";
}

const keyOf = (path: Path): string => JSON.stringify(path);

/** Every subschema of `node`, as [keyword, ...location] relative paths. */
function childPaths(node: SchemaObject): Path[] {
  const paths: Path[] = [];
  for (const key of SCHEMA_KEYWORDS) {
    if (isSchema(node[key])) paths.push([key]);
  }
  for (const key of SCHEMA_ARRAY_KEYWORDS) {
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach((sub, i) => {
        if (isSchema(sub)) paths.push([key, String(i)]);
      });
    }
  }
  for (const key of SCHEMA_MAP_KEYWORDS) {
    const value = node[key];
    if (isObject(value)) {
      for (const [name, sub] of Object.entries(value)) {
        // `dependencies` may map to a string array (property dependency).
        if (isSchema(sub)) paths.push([key, name]);
      }
    }
  }
  // `items` is either one subschema or (draft-07 tuple form) an array.
  if (Array.isArray(node.items)) {
    node.items.forEach((sub, i) => {
      if (isSchema(sub)) paths.push(["items", String(i)]);
    });
  } else if (isSchema(node.items)) {
    paths.push(["items"]);
  }
  return paths;
}

function getAt(node: SchemaObject, rel: Path): unknown {
  let value: unknown = node;
  for (const part of rel) value = (value as Record<string, unknown>)[part];
  return value;
}

/**
 * Parse a `$ref` the way Ajv resolves a local JSON pointer: split on `/`,
 * then URI-decode and JSON-pointer-unescape each segment. `null` for any
 * reference that is not a local `#` / `#/...` pointer.
 */
function parseLocalRef(ref: string): Path | null {
  if (ref === "#") return [];
  if (!ref.startsWith("#/")) return null;
  try {
    return ref
      .slice(2)
      .split("/")
      .map((part) =>
        decodeURIComponent(part).replace(/~1/g, "/").replace(/~0/g, "~"),
      );
  } catch {
    return null; // malformed percent-encoding
  }
}

function formatRef(path: Path): string {
  return (
    "#" +
    path
      .map(
        (part) =>
          "/" +
          encodeURIComponent(part.replace(/~/g, "~0").replace(/\//g, "~1")),
      )
      .join("")
  );
}

type NodeInfo = {
  /** Lost something itself: a `pattern`, or non-empty `patternProperties`. */
  direct: boolean;
  children: string[];
  /** The `$ref`'s target position, `null` if it cannot be kept. */
  ref?: string | null;
  /** Has a `$dynamicRef` / `$recursiveRef`, which is never kept. */
  dynamic?: boolean;
};

/** References whose target depends on the dynamic scope; always removed. */
const DYNAMIC_REF_KEYWORDS = ["$dynamicRef", "$recursiveRef"];

export function stripSchemaPatterns(schema: unknown): StrippedSchema {
  // Pass 1: find every schema position, and what each one depends on.
  const nodes = new Map<string, NodeInfo>();
  const rawRefs = new Map<string, string>();
  let hasId = false;

  const analyze = (node: unknown, path: Path): void => {
    const info: NodeInfo = { direct: false, children: [] };
    nodes.set(keyOf(path), info);
    if (!isObject(node)) return; // `true` / `false` schemas, or junk
    if ("$id" in node) hasId = true;
    if (typeof node.pattern === "string") info.direct = true;
    if (
      isObject(node.patternProperties) &&
      Object.keys(node.patternProperties).length > 0
    ) {
      info.direct = true;
    }
    if (typeof node.$ref === "string") rawRefs.set(keyOf(path), node.$ref);
    if (DYNAMIC_REF_KEYWORDS.some((key) => key in node)) info.dynamic = true;
    for (const rel of childPaths(node)) {
      const childPath = [...path, ...rel];
      info.children.push(keyOf(childPath));
      analyze(getAt(node, rel), childPath);
    }
  };
  analyze(schema, []);

  for (const [key, ref] of rawRefs) {
    const target = hasId ? null : parseLocalRef(ref);
    const targetKey = target === null ? null : keyOf(target);
    nodes.get(key)!.ref =
      targetKey !== null && nodes.has(targetKey) ? targetKey : null;
  }

  // Pass 2: a position is tainted if it, a subschema, or a `$ref` target
  // lost anything. Iterate to a fixed point so reference cycles settle.
  const tainted = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const [key, info] of nodes) {
      if (tainted.has(key)) continue;
      if (
        info.direct ||
        info.ref === null ||
        info.dynamic ||
        info.children.some((child) => tainted.has(child)) ||
        (info.ref !== undefined && tainted.has(info.ref))
      ) {
        tainted.add(key);
        changed = true;
      }
    }
  }

  // Pass 3: emit the sanitized copy, recording where each input position
  // landed so references can be rewritten to it.
  let stripped = 0;
  let skipped = 0;
  const outputPath = new Map<string, Path>();
  const refSites: { node: SchemaObject; target: string | null }[] = [];
  const holding: { node: unknown; path: Path }[] = [];
  const root = isObject(schema) ? schema : undefined;
  const takenNames = new Set(
    isObject(root?.definitions) ? Object.keys(root.definitions) : [],
  );
  let nextName = 0;

  /** Move a subschema somewhere nothing applies it, keeping it resolvable. */
  const relocate = (node: unknown, path: Path): void => {
    holding.push({ node, path });
  };

  const emit = (node: unknown, inPath: Path, outPath: Path): unknown => {
    outputPath.set(keyOf(inPath), outPath);
    if (!isObject(node)) return node;
    const copy: SchemaObject = { ...node };
    const isTainted = (rel: Path) => tainted.has(keyOf([...inPath, ...rel]));

    if (typeof copy.pattern === "string") {
      delete copy.pattern;
      stripped++;
    }
    if (
      isObject(copy.patternProperties) &&
      Object.keys(copy.patternProperties).length > 0
    ) {
      for (const name of Object.keys(copy.patternProperties)) {
        relocate(copy.patternProperties[name], [
          ...inPath,
          "patternProperties",
          name,
        ]);
        stripped++;
      }
      delete copy.patternProperties;
      // See the header: without the regexes, which keys are "additional" is
      // unknowable, so this constraint is skipped too.
      if ("additionalProperties" in copy) {
        if (isSchema(copy.additionalProperties)) {
          relocate(copy.additionalProperties, [
            ...inPath,
            "additionalProperties",
          ]);
        }
        delete copy.additionalProperties;
        skipped++;
      }
    }

    // Keywords where a looser subschema can produce a false failure.
    const dropIfTainted = (keyword: string, alsoDrop: string[] = []) => {
      if (!(keyword in copy)) return;
      const rels = childPaths({ [keyword]: copy[keyword] });
      if (!rels.some(isTainted)) return;
      for (const rel of rels) relocate(getAt(copy, rel), [...inPath, ...rel]);
      delete copy[keyword];
      for (const extra of alsoDrop) delete copy[extra];
      skipped++;
    };
    dropIfTainted("not");
    dropIfTainted("oneOf");
    if ("if" in copy && isTainted(["if"])) {
      for (const keyword of ["if", "then", "else"]) {
        if (isSchema(copy[keyword])) {
          relocate(copy[keyword], [...inPath, keyword]);
        }
        delete copy[keyword];
      }
      skipped++;
    }
    dropIfTainted("contains", ["minContains", "maxContains"]);
    if (tainted.has(keyOf(inPath))) {
      // What counts as "evaluated" depends on the sibling keywords, which
      // lost something, so these can no longer be judged.
      for (const keyword of ["unevaluatedProperties", "unevaluatedItems"]) {
        if (keyword in copy) {
          if (isSchema(copy[keyword])) {
            relocate(copy[keyword], [...inPath, keyword]);
          }
          delete copy[keyword];
          skipped++;
        }
      }
    }

    for (const keyword of DYNAMIC_REF_KEYWORDS) {
      if (keyword in copy) {
        delete copy[keyword];
        skipped++;
      }
    }
    if (typeof copy.$ref === "string") {
      refSites.push({
        node: copy,
        target: nodes.get(keyOf(inPath))?.ref ?? null,
      });
    }

    // Recurse into whatever subschemas are still applied here.
    for (const rel of childPaths(copy)) {
      const sub = emit(
        getAt(copy, rel),
        [...inPath, ...rel],
        [...outPath, ...rel],
      );
      // `childPaths` yields [keyword] or [keyword, name].
      const [keyword, name] = rel as [string, string | undefined];
      if (name === undefined) {
        copy[keyword] = sub;
      } else {
        const container = copy[keyword];
        if (Array.isArray(container)) {
          const items = [...container];
          items[Number(name)] = sub;
          copy[keyword] = items;
        } else {
          copy[keyword] = { ...(container as SchemaObject), [name]: sub };
        }
      }
    }
    return copy;
  };

  const output = emit(schema, [], []);

  if (isObject(output) && holding.length > 0) {
    const definitions: SchemaObject = isObject(output.definitions)
      ? { ...output.definitions }
      : {};
    // A held subschema may itself hold more; iterating the array as it
    // grows picks those up.
    for (const { node, path } of holding) {
      let name: string;
      do {
        name = `${HOLDING_PREFIX}${nextName++}`;
      } while (takenNames.has(name));
      takenNames.add(name);
      definitions[name] = emit(node, path, ["definitions", name]);
    }
    output.definitions = definitions;
  }

  for (const site of refSites) {
    const target =
      site.target === null ? undefined : outputPath.get(site.target);
    if (target === undefined) {
      delete site.node.$ref;
      skipped++;
    } else {
      site.node.$ref = formatRef(target);
    }
  }

  return { schema: output, stripped, skipped };
}

/** The user-facing note for a schema that had checks removed. */
export function patternsNotEvaluatedNote(
  stripped: number,
  skipped = 0,
): string {
  const parts: string[] = [];
  if (stripped > 0) {
    parts.push(
      `${stripped} regex pattern(s) in this schema were not evaluated`,
    );
  }
  if (skipped > 0) {
    parts.push(
      `${skipped} check(s) in this schema were skipped because they depend on an unevaluated pattern or an unresolvable $ref`,
    );
  }
  return parts.join("; ");
}
