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
/** Where a subschema sits in its parent: `[keyword]` or `[keyword, name]`. */
type Rel = [string] | [string, string];

function isObject(value: unknown): value is SchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchema(value: unknown): boolean {
  return isObject(value) || typeof value === "boolean";
}

/** A map key for a `Rel`. Keywords never contain NUL, so this is unique. */
const relKey = (rel: Rel): string =>
  rel.length === 1 ? rel[0] : `${rel[0]}\u0000${rel[1]}`;

/** Every subschema of `node`, as relative locations. */
function childRels(node: SchemaObject): Rel[] {
  const rels: Rel[] = [];
  for (const key of SCHEMA_KEYWORDS) {
    if (isSchema(node[key])) rels.push([key]);
  }
  for (const key of SCHEMA_ARRAY_KEYWORDS) {
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach((sub, i) => {
        if (isSchema(sub)) rels.push([key, String(i)]);
      });
    }
  }
  for (const key of SCHEMA_MAP_KEYWORDS) {
    const value = node[key];
    if (isObject(value)) {
      for (const [name, sub] of Object.entries(value)) {
        // `dependencies` may map to a string array (property dependency).
        if (isSchema(sub)) rels.push([key, name]);
      }
    }
  }
  // `items` is either one subschema or (draft-07 tuple form) an array.
  if (Array.isArray(node.items)) {
    node.items.forEach((sub, i) => {
      if (isSchema(sub)) rels.push(["items", String(i)]);
    });
  } else if (isSchema(node.items)) {
    rels.push(["items"]);
  }
  return rels;
}

function getAt(node: SchemaObject, rel: Rel): unknown {
  const value = node[rel[0]];
  return rel.length === 1 ? value : (value as SchemaObject)[rel[1]];
}

/**
 * Parse a `$ref` the way Ajv resolves a local JSON pointer: split on `/`,
 * then URI-decode and JSON-pointer-unescape each segment. `null` for any
 * reference that is not a local `#` / `#/...` pointer.
 */
function parseLocalRef(ref: string): string[] | null {
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

const formatSegment = (part: string): string =>
  "/" + encodeURIComponent(part.replace(/~/g, "~0").replace(/\//g, "~1"));

/** One schema position of the input. Positions are numbered; 0 is the root. */
type Position = {
  node: unknown;
  /** The enclosing position, -1 for the root. */
  parent: number;
  /** Subschemas, by `relKey`. */
  children: Map<string, number>;
  /** Lost something itself: a `pattern`, or non-empty `patternProperties`. */
  direct: boolean;
  /** Has a `$dynamicRef` / `$recursiveRef`, which is never kept. */
  dynamic: boolean;
  /** The `$ref`'s target position, `null` if it cannot be kept. */
  ref?: number | null;
};

/** References whose target depends on the dynamic scope; always removed. */
const DYNAMIC_REF_KEYWORDS = ["$dynamicRef", "$recursiveRef"];

/**
 * Every pass below is linear in the size of the schema: each position is
 * visited once, each container is copied once, taint spreads along reversed
 * edges with a work list, and positions are numbers rather than paths (a path
 * per position would cost O(depth) each). Only the pointers actually written
 * into rewritten `$ref`s are built as strings, memoized per position.
 */
export function stripSchemaPatterns(schema: unknown): StrippedSchema {
  // Pass 1: number every schema position, and record what each depends on.
  const positions: Position[] = [];
  const rawRefs: [number, string][] = [];
  let hasId = false;

  const analyze = (node: unknown, parent: number): number => {
    const id = positions.length;
    const position: Position = {
      node,
      parent,
      children: new Map(),
      direct: false,
      dynamic: false,
    };
    positions.push(position);
    if (!isObject(node)) return id; // `true` / `false` schemas, or junk
    if ("$id" in node) hasId = true;
    if (typeof node.pattern === "string") position.direct = true;
    if (
      isObject(node.patternProperties) &&
      Object.keys(node.patternProperties).length > 0
    ) {
      position.direct = true;
    }
    if (typeof node.$ref === "string") rawRefs.push([id, node.$ref]);
    if (DYNAMIC_REF_KEYWORDS.some((key) => key in node)) {
      position.dynamic = true;
    }
    for (const rel of childRels(node)) {
      position.children.set(relKey(rel), analyze(getAt(node, rel), id));
    }
    return id;
  };
  analyze(schema, -1);

  /** The position a pointer names, if it names one. */
  const resolve = (segments: string[]): number | null => {
    let current = 0;
    for (let i = 0; i < segments.length;) {
      const { children } = positions[current]!;
      const single = children.get(segments[i]!);
      if (single !== undefined) {
        current = single;
        i += 1;
        continue;
      }
      if (i + 1 >= segments.length) return null;
      const pair = children.get(`${segments[i]}\u0000${segments[i + 1]}`);
      if (pair === undefined) return null;
      current = pair;
      i += 2;
    }
    return current;
  };

  const referrers = new Map<number, number[]>();
  for (const [id, ref] of rawRefs) {
    const segments = hasId ? null : parseLocalRef(ref);
    const target = segments === null ? null : resolve(segments);
    positions[id]!.ref = target;
    if (target !== null) {
      const list = referrers.get(target) ?? [];
      list.push(id);
      referrers.set(target, list);
    }
  }

  // Pass 2: a position is tainted if it, a subschema, or a `$ref` target
  // lost anything. Spread from the seeds along reversed edges (to the parent
  // and to every referrer); each position enters the work list at most once.
  const tainted = new Uint8Array(positions.length);
  const work: number[] = [];
  const taint = (id: number) => {
    if (id < 0 || tainted[id]) return;
    tainted[id] = 1;
    work.push(id);
  };
  positions.forEach((position, id) => {
    if (position.direct || position.dynamic || position.ref === null) {
      taint(id);
    }
  });
  while (work.length > 0) {
    const id = work.pop()!;
    taint(positions[id]!.parent);
    for (const referrer of referrers.get(id) ?? []) taint(referrer);
  }

  // Pass 3: emit the sanitized copy, recording where each position landed
  // (its output parent and location) so references can be rewritten to it.
  let stripped = 0;
  let skipped = 0;
  const outParent = new Int32Array(positions.length).fill(-2); // -2: unset
  const outRel = new Array<string[]>(positions.length);
  const refSites: { node: SchemaObject; target: number | null }[] = [];
  const holding: number[] = [];
  const root = isObject(schema) ? schema : undefined;
  const takenNames = new Set(
    isObject(root?.definitions) ? Object.keys(root.definitions) : [],
  );
  let nextName = 0;

  const emit = (id: number): unknown => {
    const { node, children } = positions[id]!;
    if (!isObject(node)) return node;
    const copy: SchemaObject = { ...node };
    const childOf = (rel: Rel): number => children.get(relKey(rel))!;
    /** Move a subschema somewhere nothing applies it, keeping it resolvable. */
    const relocate = (rel: Rel) => holding.push(childOf(rel));
    const isTainted = (rel: Rel) => tainted[childOf(rel)] === 1;

    if (typeof copy.pattern === "string") {
      delete copy.pattern;
      stripped++;
    }
    if (
      isObject(copy.patternProperties) &&
      Object.keys(copy.patternProperties).length > 0
    ) {
      for (const name of Object.keys(copy.patternProperties)) {
        if (isSchema(copy.patternProperties[name])) {
          relocate(["patternProperties", name]);
        }
        stripped++;
      }
      delete copy.patternProperties;
      // See the header: without the regexes, which keys are "additional" is
      // unknowable, so this constraint is skipped too.
      if ("additionalProperties" in copy) {
        if (isSchema(copy.additionalProperties)) {
          relocate(["additionalProperties"]);
        }
        delete copy.additionalProperties;
        skipped++;
      }
    }

    // Keywords where a looser subschema can produce a false failure.
    const dropIfTainted = (keyword: string, alsoDrop: string[] = []) => {
      if (!(keyword in copy)) return;
      const rels = childRels({ [keyword]: copy[keyword] });
      if (!rels.some(isTainted)) return;
      rels.forEach(relocate);
      delete copy[keyword];
      for (const extra of alsoDrop) delete copy[extra];
      skipped++;
    };
    dropIfTainted("not");
    dropIfTainted("oneOf");
    if (isSchema(copy.if) && isTainted(["if"])) {
      for (const keyword of ["if", "then", "else"]) {
        if (isSchema(copy[keyword])) relocate([keyword]);
        delete copy[keyword];
      }
      skipped++;
    }
    dropIfTainted("contains", ["minContains", "maxContains"]);
    if (tainted[id]) {
      // What counts as "evaluated" depends on the sibling keywords, which
      // lost something, so these can no longer be judged.
      for (const keyword of ["unevaluatedProperties", "unevaluatedItems"]) {
        if (keyword in copy) {
          if (isSchema(copy[keyword])) relocate([keyword]);
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
      refSites.push({ node: copy, target: positions[id]!.ref ?? null });
    }

    // Recurse into whatever subschemas are still applied here. Each array or
    // map is copied once, then filled in, so the original is never mutated.
    const cloned = new Set<string>();
    for (const rel of childRels(copy)) {
      const child = childOf(rel);
      outParent[child] = id;
      outRel[child] = rel;
      const sub = emit(child);
      if (rel.length === 1) {
        copy[rel[0]] = sub;
        continue;
      }
      const [keyword, name] = rel;
      if (!cloned.has(keyword)) {
        cloned.add(keyword);
        const container = copy[keyword];
        copy[keyword] = Array.isArray(container)
          ? [...container]
          : { ...(container as SchemaObject) };
      }
      (copy[keyword] as SchemaObject)[name] = sub;
    }
    return copy;
  };

  outParent[0] = -1;
  outRel[0] = [];
  const output = emit(0);

  if (isObject(output) && holding.length > 0) {
    const definitions: SchemaObject = isObject(output.definitions)
      ? { ...output.definitions }
      : {};
    // A held subschema may itself hold more; iterating the array as it
    // grows picks those up.
    for (const id of holding) {
      let name: string;
      do {
        name = `${HOLDING_PREFIX}${nextName++}`;
      } while (takenNames.has(name));
      takenNames.add(name);
      outParent[id] = 0;
      outRel[id] = ["definitions", name];
      definitions[name] = emit(id);
    }
    output.definitions = definitions;
  }

  // Build the pointer for each referenced position once, from its parent's.
  const pointers = new Map<number, string>();
  const pointerOf = (id: number): string | undefined => {
    if (outParent[id] === -2) return undefined; // never emitted
    if (id === 0) return "#";
    const memo = pointers.get(id);
    if (memo !== undefined) return memo;
    // Walk up iteratively to the nearest memoized ancestor (no recursion, so
    // a deep schema cannot overflow the stack here).
    const chain: number[] = [];
    let current = id;
    while (current !== 0 && !pointers.has(current)) {
      chain.push(current);
      current = outParent[current]!;
    }
    let pointer = current === 0 ? "#" : pointers.get(current)!;
    for (let i = chain.length - 1; i >= 0; i--) {
      const link = chain[i]!;
      pointer += outRel[link]!.map(formatSegment).join("");
      pointers.set(link, pointer);
    }
    return pointer;
  };

  for (const site of refSites) {
    const pointer = site.target === null ? undefined : pointerOf(site.target);
    if (pointer === undefined) {
      delete site.node.$ref;
      skipped++;
    } else {
      site.node.$ref = pointer;
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
