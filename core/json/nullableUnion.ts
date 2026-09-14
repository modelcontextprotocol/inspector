/**
 * Flattening of the two JSON Schema encodings of "this type, **or** null" into
 * the plain type a form renderer can dispatch on.
 *
 * Shared because both form builders — the web client's `SchemaForm` and the
 * TUI's `schemaToForm` — dispatch on a *single* `type` string, and so both miss
 * a nullable field entirely without this step (#1928, #2015). Keeping one copy
 * is what stops the two clients from disagreeing about which schemas they can
 * render; the alternative was two implementations of the same subtle predicate.
 */

/**
 * JSON Schema type names a form renderer can build a widget for.
 *
 * `"null"` is deliberately absent: it is the branch a nullable union is being
 * flattened *away* from, and there is no widget for a field whose only
 * permitted value is `null`.
 */
const RENDERABLE_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
] as const;

/** A `type` name the collapse is willing to produce. */
export type RenderableType = (typeof RENDERABLE_TYPES)[number];

function isRenderableType(type: unknown): type is RenderableType {
  return RENDERABLE_TYPES.includes(type as RenderableType);
}

/**
 * The keywords {@link normalizeNullableUnion} reads. Both clients' own schema
 * types are structurally assignable to this, so neither has to adopt the
 * other's — the shape is deliberately the minimum needed to *recognize* a
 * nullable union, not a full JSON Schema model.
 */
export interface NullableUnionSchema {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: readonly unknown[];
  // Read only by `admitsNull`, which considers encodings the collapse itself
  // declines to flatten, and the sibling constraints that can rule null out.
  oneOf?: readonly unknown[];
  allOf?: readonly unknown[];
  not?: unknown;
  $ref?: string;
  nullable?: boolean;
  const?: unknown;
}

/** Narrow an `anyOf` member to a readable object, or `null` if it isn't one. */
function toBranch(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Whether an `enum` is one that can be rendered as a string-valued dropdown.
 *
 * JSON Schema's `enum` is untyped — `[1, 2]`, `[true, false]`, and `[null]` are
 * all legal — so a bare `{ enum: [...] }` does **not** imply strings. Guessing
 * `"string"` for a numeric enum would hand non-strings to a renderer that has
 * declared them `string[]`: the web `Select` would receive numbers, and the TUI
 * would `String(...)` them and submit `"1"` where the server expects `1`. So
 * only an all-string enum earns the inference; anything else stays on the
 * fallback path, which renders the value honestly as JSON.
 *
 * Exported because the same question decides whether a *dispatcher* may route
 * an enum to a select at all. The TUI's does, and its options are stringified,
 * so an unguarded numeric enum there submits `"1"` where the server wants `1`.
 */
export function isStringEnum(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((member) => typeof member === "string")
  );
}

/**
 * The result of a collapse that actually matched. Spelled out rather than
 * reusing `T` because the collapse genuinely changes two of `T`'s fields:
 * `type` becomes a single renderable name (never an array, never `"null"`),
 * and `anyOf` is cleared. Returning `T` for these would let a caller whose `T`
 * types `type` as an array go on treating it as one after it has become a
 * string, or dereference an `anyOf` that is now `undefined`.
 *
 * Note this cannot make the *hoist* sound: an `anyOf` branch is `unknown`, so
 * any keyword lifted off it is whatever the server sent, however `T` declares
 * it. {@link isStringEnum} validates the one keyword the renderers dereference
 * as a typed array (`enum`); the rest reach widgets that read them defensively.
 */
export type NormalizedNullableUnion<T extends NullableUnionSchema> = Omit<
  T,
  "type" | "anyOf"
> & {
  type?: RenderableType;
  anyOf?: undefined;
  nullable?: boolean;
};

/**
 * Whether a schema's **own** `enum`/`const` rules `null` out, regardless of what
 * its `type` or union branches say.
 *
 * JSON Schema keywords at one level are **conjunctive** — a value must satisfy
 * all of them — so a syntactic null does not by itself mean the schema accepts
 * null. `{ type: ["string", "null"], enum: ["envio"] }` names `"null"` in its
 * type list and still rejects `null`, because the `enum` does not offer it.
 * Marking that field nullable would give it a clear button that emits a value
 * the schema forbids, and would make required-field gating accept it.
 *
 * Evaluated against the schema's own level only. A branch's `enum` is *not* a
 * sibling — in `anyOf: [{ type: "string", enum: [...] }, { type: "null" }]` the
 * enum constrains that branch alone, and the union still permits null. Reading
 * it as a sibling would break exactly the shape #1928 is about, so callers must
 * pass the original schema here, never the hoisted merge.
 */
function nullExcludedBySiblings(schema: NullableUnionSchema): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.includes(null)) {
    return true;
  }
  return schema.const !== undefined && schema.const !== null;
}

/**
 * Keywords that only *describe* a field. Everything else constrains what values
 * are valid.
 *
 * This is an **allowlist on purpose**, and the direction matters. The previous
 * version enumerated the *validation* keywords and declined on a conflict among
 * them, which meant any keyword nobody thought of — `oneOf`, `allOf`, `not`,
 * `$ref`, a future vocabulary — was silently treated as safe to drop. A missing
 * entry there fails open, and open means rendering a widget for a constraint
 * that is not the schema's. Listing the harmless keys instead fails closed: an
 * unrecognized keyword sends the field to the JSON editor, which is the correct
 * answer for a schema this module does not understand.
 */
const ANNOTATION_KEYWORDS = new Set([
  "title",
  "description",
  "default",
  "enumNames",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "$comment",
  "$schema",
  "$id",
]);

/**
 * Whether hoisting a branch would *drop* something the wrapper constrains.
 *
 * The hoist is a spread, so a branch key replaces the wrapper's — but JSON
 * Schema applies sibling keywords **conjunctively**, and a replacement is not a
 * conjunction. A wrapper `enum: ["a"]` around a branch `enum: ["a", "b"]` means
 * `"a"` (both must hold), yet the spread yields `["a", "b"]` and the rendered
 * dropdown would offer — and submit — a `"b"` the schema rejects. `type`,
 * bounds, the object keywords, and the applicators (`oneOf`, `allOf`, `not`)
 * all fail the same way.
 *
 * Rather than intersect them — a much larger surface, and one where a subtly
 * wrong intersection is worse than none because it renders a *plausible* widget
 * for the wrong constraint — the collapse **declines** whenever the wrapper
 * carries anything beyond annotations and the union itself. The field then
 * renders through the JSON editor with its full schema intact.
 *
 * This is stricter than comparing values for equality: a wrapper that merely
 * restates its branch's `type` now also declines. That costs a dropdown on a
 * rare redundant shape and buys a rule with no gap in it, which is the better
 * trade for a module that cannot evaluate JSON Schema.
 */
function wrapperCarriesConstraints(schema: NullableUnionSchema): boolean {
  return Object.keys(schema).some(
    (key) => key !== "anyOf" && !ANNOTATION_KEYWORDS.has(key),
  );
}

/** Whether a schema's `type` names `"null"` at all. */
function typeNamesNull(type: unknown): boolean {
  return Array.isArray(type) ? type.includes("null") : type === "null";
}

/**
 * Applicators this module does not evaluate, and which are **conjunctive** with
 * everything beside them — so any of them can rule `null` out, or constrain a
 * value in a way no widget here would honor.
 *
 * `anyOf` is excluded because it is the keyword being *recognized*: a caller
 * that has already identified the nullable-union shape checks it directly. Every
 * other position treats a stray `anyOf` as opaque too.
 */
function hasOpaqueApplicator(schema: NullableUnionSchema): boolean {
  return (
    schema.not !== undefined ||
    schema.allOf !== undefined ||
    schema.oneOf !== undefined ||
    // `$ref` points at a schema this module never resolves, and it applies
    // *alongside* its siblings — `{ type: "string", $ref: "#/$defs/intOnly" }`
    // can be unsatisfiable. The wrapper path already declines on it (it is not
    // an annotation); this is the same rule for every other position.
    schema.$ref !== undefined
  );
}

/**
 * Whether a schema composes further constraints this module cannot evaluate —
 * {@link hasOpaqueApplicator}, **plus a nested `anyOf`**.
 *
 * This is the single test every position uses on a schema that is *not* the
 * union being recognized: the surviving branch, a null branch, and the
 * `type: [T, "null"]` schema. Each of those was missed independently at some
 * point — the guard existed but was spelled out inline and drifted between
 * sites — so they now share one predicate rather than three conditions that
 * have to be kept in step.
 *
 * A nested `anyOf` matters as much as the others because the hoist *drops* it:
 * the branch's `anyOf` overwrites the wrapper's in the spread and is then
 * cleared, so `{ anyOf: [{ type: "string", anyOf: [...] }, { type: "null" }] }`
 * would otherwise widen into an unconstrained nullable string.
 */
function hasUnevaluatedComposition(schema: NullableUnionSchema): boolean {
  return schema.anyOf !== undefined || hasOpaqueApplicator(schema);
}

/**
 * What {@link stripNullEnumMembers} concluded about an `enum`.
 *
 * `"unselectable"` is a distinct outcome rather than "an empty list" because it
 * has to **stop the collapse**, not just empty a field. See below.
 */
type EnumStrip =
  | { kind: "unchanged" }
  | { kind: "filtered"; members: unknown[]; names?: unknown }
  | { kind: "unselectable" };

/**
 * Drop `null` members from an `enum`, keeping the parallel `enumNames` aligned.
 *
 * The `type: [T, "null"]` encoding keeps its keywords at the top level, so a
 * nullable enum written that way carries the null *inside* the list:
 * `{ type: ["string", "null"], enum: ["envio", "recebimento", null] }`. The
 * collapse has already moved that fact onto `nullable`, so leaving the sentinel
 * in the list breaks both renderers in different ways — the web dispatcher
 * would hand `null` to Mantine as option data, and the TUI's all-strings check
 * would reject the whole enum and fall back to a plain text field.
 *
 * **`enumNames` is filtered by the same indices, not left alone.** It is a
 * positional parallel array, and both renderers discard labels outright when
 * the two lengths disagree — so stripping one without the other silently loses
 * every label rather than just the dropped one's.
 *
 * **An enum that offers no selectable value reports `"unselectable"`, so the
 * caller declines to collapse at all.** That covers `[null]` and the empty
 * `[]`: the first permits only `null`, the second permits nothing. Emitting
 * `enum: undefined` instead would turn either into a plain string field
 * accepting arbitrary text — trading a cosmetic problem for a correctness one,
 * since the form would then invite values the schema forbids. Left uncollapsed
 * they render through the JSON editor, which represents them honestly.
 */
function stripNullEnumMembers(members: unknown, names: unknown): EnumStrip {
  if (!Array.isArray(members)) {
    return { kind: "unchanged" };
  }
  const kept = members
    .map((member, index) => ({ member, index }))
    .filter((entry) => entry.member !== null);
  // An empty `enum` permits nothing at all, so it reaches the same conclusion
  // as `[null]` by a different route: there is no value a dropdown could offer.
  if (kept.length === 0) {
    return { kind: "unselectable" };
  }
  if (kept.length === members.length) {
    return { kind: "unchanged" };
  }
  // Only realign names that were positionally parallel to begin with, and DROP
  // them otherwise. Keeping a mismatched list is not neutral: filtering shortens
  // `enum`, so `enum: [null, "b"]` with `enumNames: ["None"]` would come out the
  // same length and start *labelling* `b` as "None" — turning labels both
  // renderers had correctly ignored into a confident mislabel.
  const wasParallel = Array.isArray(names) && names.length === members.length;
  const aligned = wasParallel
    ? kept.map((entry) => names[entry.index])
    : undefined;
  return {
    kind: "filtered",
    members: kept.map((entry) => entry.member),
    names: aligned,
  };
}

/**
 * Build the collapsed schema.
 *
 * The assertion is needed because the spread merges an unresolved generic `T`
 * with an `unknown` branch, and `NormalizedNullableUnion<T>`'s `Omit` stays
 * deferred while `T` is open — so TS cannot verify the two line up even though
 * every field is set right here. Isolated in this one function so the exported
 * signature carries the contract and nothing else has to assert it.
 *
 * Returns `null` when the merged schema turns out to permit only `null`, which
 * is not collapsible; see {@link stripNullEnumMembers}.
 */
function collapsed<T extends NullableUnionSchema>(
  schema: T,
  branch: Record<string, unknown> | undefined,
  type: RenderableType,
): NormalizedNullableUnion<T> | null {
  const merged = { ...schema, ...branch };
  // Read after the merge so the branch's list wins when it has one.
  const strip = stripNullEnumMembers(
    merged.enum,
    (merged as { enumNames?: unknown }).enumNames,
  );
  if (strip.kind === "unselectable") {
    return null;
  }
  return {
    ...merged,
    type,
    anyOf: undefined,
    // Read off the ORIGINAL schema, not the merge: a hoisted branch `enum` is
    // not a sibling constraint, and treating it as one would mark the very
    // shape #1928 is about as non-nullable. See `nullExcludedBySiblings`.
    nullable: admitsNull(schema),
    ...(strip.kind === "filtered"
      ? { enum: strip.members, enumNames: strip.names }
      : {}),
  } as NormalizedNullableUnion<T>;
}

/**
 * Whether a schema permits an explicit `null`.
 *
 * Deliberately **independent of {@link normalizeNullableUnion}**, which is a
 * *renderer* question — "can this become one widget?" — and is therefore
 * narrower on purpose: it only collapses a two-member union. Null admission is
 * a *validity* question and has no such limit, so
 * `anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }]` admits
 * null even though it renders through the JSON fallback. Deriving one from the
 * other would make a form reject a value its own schema accepts, which is why
 * these are two functions rather than a `.nullable` flag read off the collapse.
 *
 * **Answers `false` for anything it cannot fully evaluate**, which is a larger
 * set than it may look. Recognized: `nullable: true`, `type: "null"`,
 * `type: [..., "null"]`, and a `"null"` branch in an `anyOf` of any size.
 * Deliberately *not* recognized, despite naming null:
 *
 * - **`oneOf`** — it requires *exactly one* branch to match, so a `null` branch
 *   does not mean `null` validates; two matching branches make it fail.
 * - **`not` / `allOf`**, at this level or on the branch, which can rule null out.
 * - **A sibling `anyOf` beside an explicit `type`**, since the two are
 *   conjunctive and the union is not evaluated here.
 * - **A branch that names null but is unsatisfiable**, whether by its own
 *   `enum`/`const` or its own nested applicators.
 *
 * The asymmetry is what settles the direction: under-claiming costs a clear
 * button and treats a valid `null` as missing, while over-claiming lets the
 * form emit a value the schema rejects. So callers get a firm "no" rather than
 * an optimistic guess, and a schema this module cannot read renders through the
 * JSON editor with its constraints intact.
 */
/** Whether an absent or null-naming `type` leaves null on the table. */
function typeAdmitsNull(type: string | string[] | undefined): boolean {
  return type === undefined || typeNamesNull(type);
}

export function admitsNull(schema: NullableUnionSchema): boolean {
  if (nullExcludedBySiblings(schema)) {
    return false;
  }
  // Applicators this module does not evaluate. `not: { type: "null" }` rules
  // null out; `allOf` can add a member that does; and `oneOf` requires
  // **exactly one** branch to match, so a null branch does not by itself mean
  // `null` validates — two matching branches make it fail. Rather than answer
  // these half-correctly, say no: under-claiming nullability costs a clear
  // button, while over-claiming lets the form emit a value the schema rejects.
  if (hasOpaqueApplicator(schema)) {
    return false;
  }
  // `const: null` admits null and nothing else — the case a required field
  // pinned to null needs, or it is seeded with the only value it accepts and
  // then reported missing, leaving submit permanently disabled on a field the
  // user cannot change (#2123).
  //
  // Claimed only where the siblings agree, since `const` is conjunctive with
  // them rather than an override: `{ type: "string", const: null }` and
  // `{ const: null, anyOf: [...] }` reject every value, and saying otherwise
  // would let the gate accept a `null` the schema forbids. The opaque
  // applicators (`not`, `allOf`, `oneOf`) are already refused above.
  if (schema.const === null) {
    if (schema.nullable !== true && !typeAdmitsNull(schema.type)) return false;
    // A sibling `anyOf` is conjunctive with the `const`, so it decides too —
    // but it decides in *both* directions: `{ const: null, anyOf: [{ type:
    // "null" }] }` admits null just as plainly as an all-string union rejects
    // it. Evaluating the branches is what keeps the first case usable, since
    // the field is rendered read-only and seeded with the only value it takes.
    return schema.anyOf === undefined || anyOfAdmitsNull(schema);
  }

  // An `enum` offering `null` admits it, the same way a `const: null` does —
  // and under the same sibling conditions, since the two are equally
  // conjunctive with whatever else the schema states.
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) {
    return (
      (schema.nullable === true || typeAdmitsNull(schema.type)) &&
      (schema.anyOf === undefined || anyOfAdmitsNull(schema))
    );
  }

  if (schema.nullable === true) {
    return true;
  }
  // An explicit `type` is a sibling constraint too, so it *decides* — it does
  // not merely add a way to say yes. `{ type: "string", anyOf: [..., { type:
  // "null" }] }` rejects null, because a value must satisfy the `type` as well
  // as the union. Falling through to the branch scan here would let the union
  // override a constraint that outranks it.
  if (schema.type !== undefined) {
    // A sibling `anyOf` is conjunctive with the `type`, so it can reject null
    // even when the type list names it — `{ type: ["string", "null"], anyOf:
    // [{ type: "string" }] }` admits no null at all. Not evaluated here, so
    // its mere presence withholds the claim.
    if (schema.anyOf !== undefined) {
      return false;
    }
    return typeNamesNull(schema.type);
  }
  return anyOfAdmitsNull(schema);
}

/**
 * Keywords that annotate rather than constrain — a schema carrying only these
 * (or nothing at all) is the equivalent of `true`.
 */
const ANNOTATION_ONLY_KEYWORDS = new Set([
  "title",
  "description",
  "examples",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "$comment",
  // Core keywords that identify or declare rather than assert. `$ref` is
  // deliberately absent: it applies whatever it points at, which is exactly an
  // assertion this module cannot see.
  "$defs",
  "$id",
  "$schema",
  "$anchor",
  "$dynamicAnchor",
  "$vocabulary",
]);

/** Whether a schema states no assertion at all. */
function constrainsNothing(schema: NullableUnionSchema): boolean {
  return Object.keys(schema).every((keyword) =>
    ANNOTATION_ONLY_KEYWORDS.has(keyword),
  );
}

/** Whether some `anyOf` branch is one that admits `null`. */
function anyOfAdmitsNull(schema: NullableUnionSchema): boolean {
  const branches = schema.anyOf;
  if (!Array.isArray(branches)) return false;
  return branches.some((entry) => {
    // JSON Schema's boolean form: `true` is the unconstrained schema and admits
    // every value, `null` among them, while `false` admits none.
    if (typeof entry === "boolean") return entry;
    const branch = toBranch(entry);
    if (branch === null) return false;
    const branchSchema = branch as NullableUnionSchema;
    // A nested union or applicator inside a branch is as opaque here as one on
    // the wrapper, and refusing it also bounds this recursion: what remains is
    // a composition-free schema, which `admitsNull` answers without reaching
    // back into this function.
    if (hasUnevaluatedComposition(branchSchema)) return false;
    // A branch that constrains nothing admits every value, `null` among them.
    // `admitsNull` cannot say so on its own — an unconstrained schema tells it
    // nothing either way, and it declines rather than guesses — but here the
    // question is only whether this alternative leaves null on the table.
    if (constrainsNothing(branchSchema)) return true;
    // Asked through `admitsNull` rather than by testing `type` alone, so a
    // branch spelling its nullability another way — `{ const: null }`,
    // `{ nullable: true }` — is recognized the same way the wrapper's own
    // forms are, and an unsatisfiable `{ type: "null", const: "x" }` is still
    // rejected by the sibling check inside it.
    return admitsNull(branchSchema);
  });
}

/**
 * Collapse a nullable union — what Zod's `.nullish()` / `.nullable()` and
 * FastMCP's optional arguments emit — into `{ type: <T>, nullable: true }`.
 *
 * Two encodings mean the same thing and are both handled:
 *
 * - `anyOf: [<branch>, { type: "null" }]` — the branch's *own* keywords are
 *   hoisted onto the result, because that is where the detail a renderer needs
 *   lives. A nullable enum compiles to
 *   `anyOf: [{ type: "string", enum: [...] }, { type: "null" }]`, so hoisting
 *   `enum` is what makes it a dropdown rather than a raw-JSON fallback (#1928).
 *   The branch also wins over the wrapper on any shared key, matching v1.x.
 * - `type: [<T>, "null"]` — the keywords already sit at the top level, so only
 *   `type` collapses.
 *
 * Anything else — a union of two real types, a three-member `anyOf`, a branch
 * whose type has no widget — is returned **by identity**, so a caller can use
 * `===` to tell that nothing was recognized.
 *
 * @param schema The schema to normalize
 * @returns A flattened copy, or `schema` itself when no nullable-union pattern
 *   matches
 */
export function normalizeNullableUnion<T extends NullableUnionSchema>(
  schema: T,
): T | NormalizedNullableUnion<T> {
  if (schema.anyOf?.length === 2) {
    const branches = schema.anyOf.map(toBranch);
    const nullBranch = branches.find((entry) => entry?.type === "null");
    const branch = branches.find(
      (entry) => entry !== null && entry.type !== "null",
    );

    // Hoisting would silently drop a wrapper constraint the branch also
    // carries, so decline instead; see `branchDropsWrapperConstraint`.
    // The wrapper may only carry annotations, and the surviving branch may not
    // compose anything this module cannot evaluate — the hoist would drop it.
    if (
      nullBranch &&
      branch &&
      !wrapperCarriesConstraints(schema) &&
      !hasUnevaluatedComposition(branch as NullableUnionSchema)
    ) {
      // A branch may carry an `enum` and no `type`; JSON Schema allows that, and
      // an all-string enum is unambiguously a string field. See isStringEnum for
      // why a non-string enum deliberately does not get the same treatment.
      const type =
        branch.type ?? (isStringEnum(branch.enum) ? "string" : undefined);
      if (isRenderableType(type)) {
        // `null` when the merged enum offers nothing selectable, which is not
        // collapsible — fall through and return the schema by identity.
        const result = collapsed(schema, branch, type);
        if (result !== null) {
          return result;
        }
      }
    }
  }

  if (
    Array.isArray(schema.type) &&
    schema.type.length === 2 &&
    schema.type.includes("null") &&
    // This path keeps the schema's own keywords, but `collapsed` clears `anyOf`
    // and the renderers ignore the other applicators — so a compound schema
    // like `{ type: ["string", "null"], anyOf: [{ const: "a" }] }` would be
    // widened into an unconstrained string field. Leave it for the JSON editor.
    !hasUnevaluatedComposition(schema)
  ) {
    const type = schema.type.find((member) => member !== "null");
    if (isRenderableType(type)) {
      const result = collapsed(schema, undefined, type);
      if (result !== null) {
        return result;
      }
    }
  }

  return schema;
}
