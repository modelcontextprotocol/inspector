import type { Tool } from "@modelcontextprotocol/client";
import { normalizeNullableUnion } from "./nullableUnion.js";
import {
  narrowBySuppliedNames,
  sameJsonValue,
  resolveRootUnion,
  type RootUnionBranch,
  type RootUnionSchema,
} from "./rootUnion.js";

/**
 * JSON value type used across the inspector project
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/**
 * A JSON value that survives serialization unchanged — {@link JsonValue}
 * without `undefined`.
 *
 * `JsonValue` admits `undefined` because it is also used for *arguments*, where
 * it usefully means "this field was not supplied". That meaning does not carry
 * to a payload the Inspector promises to transmit verbatim: `JSON.stringify`
 * drops an `undefined` object member entirely and rewrites an `undefined` array
 * element to `null`, so a value the type accepted is not the value that arrives.
 *
 * Used for `_meta` (#1910), whose whole contract is that any JSON the user
 * writes reaches the wire as written.
 */
export type StrictJsonValue =
  | string
  | number
  | boolean
  | null
  | StrictJsonValue[]
  | { [key: string]: StrictJsonValue };

export type StrictJsonObject = { [key: string]: StrictJsonValue };

/**
 * Whether a value is JSON that survives `JSON.stringify` unchanged.
 *
 * {@link StrictJsonValue} is the *type*-level half of this and cannot express
 * the rest: TypeScript has one `number`, but JSON has no encoding for `NaN` or
 * `±Infinity`, so `JSON.stringify` rewrites them to `null`.
 *
 * That is reachable from ordinary input, not just from a careless caller —
 * `JSON.parse("1e400")` returns `Infinity` on overflow, so text a user typed
 * parses successfully, satisfies the type, and then reaches the wire as `null`
 * while the editor still shows what they wrote. Checking at the boundary is the
 * only place the distinction exists.
 */
export function isSerializableJson(value: unknown): value is StrictJsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      // Rejects NaN and ±Infinity; every other number round-trips.
      return Number.isFinite(value);
    case "object":
      return Array.isArray(value)
        ? value.every(isSerializableJson)
        : Object.values(value as Record<string, unknown>).every(
            isSerializableJson,
          );
    default:
      // `undefined`, functions, symbols and bigints are not JSON at all.
      return false;
  }
}

/**
 * Widen a typed object to a generic string-keyed record so its keys can be
 * iterated or read/written generically. Many of the project's config/SDK types
 * (`StoredMCPServer`, `MCPServerConfig`, `pino.Logger`, DOM `Window`, …) have no
 * index signature, so a direct `value as Record<string, unknown>` at a call
 * site is a TS2352 error that would otherwise force an `as unknown as` double
 * cast. Taking the argument as the general `object` type makes the single `as`
 * legal — `Record<string, unknown>` is assignable to `object`, so the two types
 * sufficiently overlap — letting this one audited spot own the widening while
 * the double casts stay out of the call sites. Purely a structural view of the
 * same object; no runtime effect.
 */
export function toRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Simple schema type for parameter conversion
 */
type ParameterSchema = {
  type?: string;
};

/**
 * Convert a string parameter value to the appropriate JSON type based on schema
 */
export function convertParameterValue(
  value: string,
  schema: ParameterSchema,
): JsonValue {
  if (!value) {
    return value;
  }

  if (schema.type === "number" || schema.type === "integer") {
    return Number(value);
  }

  if (schema.type === "boolean") {
    return value.toLowerCase() === "true";
  }

  if (schema.type === "object" || schema.type === "array") {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      return value;
    }
  }

  return value;
}

/**
 * Which property schema types each supplied argument, for a tool whose
 * `inputSchema` puts its fields on root composition branches (#2123).
 *
 * Reading only the root's `properties` finds no schema for any of them, so
 * every value would be sent as the string the user typed — `--tool-arg count=3`
 * reaching the server as `"3"`.
 *
 * The CLI has no branch picker, so which branch a call means is *inferred*:
 * a discriminated union pins its discriminator with `const`, and the supplied
 * arguments either match one branch's constants or they do not.
 *
 * - **Exactly one branch matches** — use its merged schema, which is also where
 *   a branch's specialization of a root-declared property lives.
 * - **No branch is identifiable** — coerce only the names every branch that
 *   declares them types the *same* way. A name two branches type differently
 *   is left uncoerced rather than coerced by an arbitrary branch: `value` as a
 *   number in branch 0 and a boolean in branch 1 would otherwise turn
 *   `value=true` into `Number("true")`, i.e. `NaN`. Passing the raw string
 *   through is what this function did for every argument before it existed.
 */
function coercionProperties<T extends RootUnionSchema>(
  base: T,
  branches: RootUnionBranch<T>[],
  params: Record<string, string>,
): Record<string, unknown> {
  if (branches.length === 0) {
    return { ...base.properties };
  }

  // Which branch the call means, from the constants it supplies and then — when
  // those leave more than one standing — from the argument NAMES it supplies,
  // through the same narrowing the form uses. Without the second step an
  // undiscriminated union whose branches type a shared name differently loses
  // the coercion for every argument in it, including the ones that identify
  // the branch unambiguously.
  const candidates = branches
    .map((branch, index) => ({ branch, index }))
    .filter(({ branch }) =>
      matchesConstants(branch.schema.properties ?? {}, params),
    )
    .map(({ index }) => index);
  const selected = narrowBySuppliedNames(
    branches,
    candidates,
    Object.keys(params),
  );
  if (selected !== null) {
    return { ...branches[selected]!.schema.properties };
  }

  // `hasOwn`/`fromEntries` rather than `in`/assignment throughout: `properties`
  // is a JSON record, so `constructor` and `__proto__` are legal argument names
  // that the prototype chain and the legacy setter would otherwise mishandle.
  const properties: Record<string, unknown> = Object.fromEntries(
    Object.entries(base.properties ?? {}),
  );
  const pool =
    candidates.length > 0 ? candidates.map((i) => branches[i]!) : branches;
  for (const name of new Set(pool.flatMap((b) => b.declaredFields))) {
    // Only the branches that *declare* the name have an opinion about it — a
    // branch that merely inherited the root's declaration is not a second,
    // disagreeing vote. Read through the merged schema so a branch's
    // specialization of a root property carries the root's keywords too.
    const declarations = pool
      .filter((branch) => branch.declaredFields.includes(name))
      .map((branch) => branch.schema.properties?.[name])
      // A malformed declaration (`properties: { x: null }`) is not a vote about
      // the type, and storing it as the coercion schema would put a value that
      // is not a schema where one is expected.
      .filter((schema) => typeof schema === "object" && schema !== null)
      // Collapsed BEFORE the vote: a nullable declaration states its real type
      // on the surviving branch, so `number | null` and `boolean | null` would
      // otherwise both read as "no type" and be counted as agreeing — and the
      // first would then coerce `value=true` to `NaN`.
      .map((schema) => normalizeNullableUnion(schema as object));
    const types = new Set(declarations.map((schema) => typeNameOf(schema)));
    // The `const` has to agree too, not just the type: `{ const: 1 }` and
    // `{ const: "1" }` both state no `type` and both match the text `1`, so
    // agreeing on the type alone would send whichever typed constant came
    // first rather than falling back to the raw string the user typed.
    const pinnedOf = (schema: unknown) =>
      typeof schema === "object" && schema !== null && "const" in schema
        ? (schema as { const?: unknown }).const
        : undefined;
    const constsAgree = declarations.every((schema) =>
      sameJsonValue(pinnedOf(schema), pinnedOf(declarations[0])),
    );
    if (types.size === 1 && constsAgree && declarations.length > 0) {
      Object.defineProperty(properties, name, {
        value: declarations[0],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } else {
      delete properties[name];
    }
  }
  return properties;
}

/** A schema's `type`, as a comparable string (`""` when it states none). */
function typeNameOf(schema: unknown): string {
  if (typeof schema !== "object" || schema === null) return "";
  const { type } = schema as { type?: unknown };
  // Sorted: JSON Schema reads an array `type` as a SET, so `["number","null"]`
  // and `["null","number"]` are the same declaration and must not read as a
  // disagreement that drops the property from the coercion map.
  return Array.isArray(type)
    ? [...type].map(String).sort().join(",")
    : typeof type === "string"
      ? type
      : "";
}

/**
 * Whether every `const`-pinned property of a branch agrees with what was
 * supplied. Values arrive as strings, so the comparison is stringified — which
 * is exactly right for a discriminator, whose constants are string literals.
 */
function matchesConstants(
  properties: Record<string, unknown>,
  params: Record<string, string>,
): boolean {
  return Object.entries(properties).every(([name, schema]) => {
    if (typeof schema !== "object" || schema === null) return true;
    const constValue = (schema as { const?: unknown }).const;
    if (constValue === undefined) return true;
    // `hasOwn`: an absent argument legally named `constructor` would otherwise
    // read the inherited one and rule out every branch that pins that name.
    if (!Object.hasOwn(params, name)) return true;
    const supplied = params[name];
    return supplied === undefined || suppliedMatchesConst(supplied, constValue);
  });
}

/**
 * Whether the text a CLI argument carries is the value a `const` fixes.
 *
 * A primitive constant is compared as text, which is all a command line has. A
 * structured one — a `const` may be an object or an array, with or without a
 * `type` — is parsed first: `String({...})` is `"[object Object]"`, which no
 * argument can equal, so the only value the schema accepts would never match.
 */
function suppliedMatchesConst(value: string, constValue: unknown): boolean {
  if (constValue === null || typeof constValue !== "object") {
    return value === String(constValue);
  }
  try {
    return sameJsonValue(JSON.parse(value), constValue);
  } catch {
    return false;
  }
}

/**
 * Convert string parameters to JSON values based on tool schema
 */
export function convertToolParameters(
  tool: Tool,
  params: Record<string, string>,
): Record<string, JsonValue> {
  return convertParametersForSchema(tool.inputSchema, params);
}

/**
 * {@link convertToolParameters} against a bare `inputSchema` rather than a
 * `Tool`.
 *
 * Split out because the two callers hold different things: the client has the
 * `Tool`, while a form holds only the schema it is rendering (which is that
 * same object, structurally narrowed). Both must reach the SAME conversion —
 * one of them decides what goes on the wire and the other decides whether to
 * let the user send it, so a second implementation would let them disagree
 * about which values are convertible.
 */
export function convertParametersForSchema(
  inputSchema: unknown,
  params: Record<string, string>,
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  // A property's schema can live on a root composition branch rather than on
  // the root itself (#2123); see `coercionProperties` for how the branch is
  // identified when it does.
  const { base, branches } = resolveRootUnion(
    (inputSchema ?? {}) as RootUnionSchema,
  );
  const properties = coercionProperties(base, branches, params);
  for (const [key, value] of Object.entries(params)) {
    const declared = properties[key];
    // Collapsed first: a nullable declaration (`type: ["number","null"]`, or an
    // `anyOf` with a null branch) states its real type on the surviving branch,
    // and `convertParameterValue` dispatches on a single `type` string — so
    // without this a nullable number is sent as the string it was typed as.
    const paramSchema =
      typeof declared === "object" && declared !== null
        ? (normalizeNullableUnion(declared) as ParameterSchema)
        : (declared as ParameterSchema | undefined);

    // A `const` the supplied text names is sent as the schema's own typed
    // value, not as the text: a branch pinned to `const: 2` is selected by
    // `kind=2` and would otherwise be sent `"2"`, which that same branch
    // rejects. Only an exact match is substituted — anything else is the
    // user's input and is left alone.
    const pinned = (paramSchema as { const?: unknown } | undefined)?.const;
    const converted =
      pinned !== undefined && suppliedMatchesConst(value, pinned)
        ? (pinned as JsonValue)
        : paramSchema
          ? convertParameterValue(value, paramSchema)
          : value;
    // `defineProperty`, not assignment: `__proto__` is a legal argument name —
    // a discriminator can carry it — and assigning it would invoke the legacy
    // prototype setter instead of putting it in the call.
    Object.defineProperty(result, key, {
      value: converted,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  return result;
}

/**
 * The argument names a `tools/call` would silently retype, per the tool's
 * schema — empty when every value is already the type the schema declares.
 *
 * Runs the conversion the client runs and compares, rather than restating its
 * rules: {@link convertParametersForSchema} is the function on the other side,
 * so asking it is the only way a caller cannot drift from what is actually
 * sent.
 *
 * Only string-valued arguments can be retyped, because that is all the
 * conversion looks at — a JSON draft that already writes `2` as a number is
 * passed through untouched, and is not reported here.
 *
 * Used by the two places a payload is authored as JSON rather than through
 * widgets — the Tools/Apps form's "Edit as JSON" switch and the
 * Edit-and-replay modal — each of which refuses a draft this returns anything
 * for, so what the editor shows is what the wire carries (#2171).
 */
export function coercedArgumentNames(
  inputSchema: unknown,
  args: Record<string, unknown>,
): string[] {
  const stringArgs: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") stringArgs[key] = value;
  }
  if (Object.keys(stringArgs).length === 0) return [];
  const converted = convertParametersForSchema(inputSchema, stringArgs);
  // `Object.keys` of the *supplied* names, so an argument the schema does not
  // declare (which the conversion passes through) cannot be reported.
  return Object.keys(stringArgs).filter(
    (key) => converted[key] !== stringArgs[key],
  );
}

/**
 * The refusal {@link coercedArgumentNames} justifies, as one sentence.
 *
 * Shared for the same reason the check is: the Tools/Apps raw-JSON editor and
 * the Edit-and-replay modal refuse the same drafts, so they must not word it
 * two different ways. `toolName` is included when the caller knows which tool
 * the draft targets — the replay modal does, because its `name` is editable
 * and the schema is looked up from it; a form is already rendering one tool
 * and would only be repeating itself.
 */
export function coercedArgumentsError(
  names: string[],
  toolName?: string,
): string {
  const quoted = names.map((name) => `\`${name}\``).join(", ");
  const whose = toolName
    ? `the type ${toolName}'s schema declares`
    : "the type the schema declares";
  return `${quoted} would be converted to ${whose} — write the value with that type instead`;
}

/**
 * Convert prompt arguments (JsonValue) to strings for prompt API
 */
export function convertPromptArguments(
  args: Record<string, JsonValue>,
): Record<string, string> {
  const stringArgs: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      stringArgs[key] = value;
    } else if (value === null || value === undefined) {
      stringArgs[key] = String(value);
    } else {
      stringArgs[key] = JSON.stringify(value);
    }
  }
  return stringArgs;
}
