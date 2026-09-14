import type { StrictJsonObject } from "@inspector/core/json/jsonUtils.js";
import { isSerializableJson } from "@inspector/core/json/jsonUtils.js";

/**
 * What a JSON-object editor's draft text currently means: the object to emit,
 * or why it cannot be emitted.
 */
export type JsonObjectDraft =
  | { ok: true; value: StrictJsonObject }
  | { ok: false; error: string };

/**
 * A plain JSON object, i.e. not an array and not a scalar.
 *
 * The `StrictJsonObject` narrowing is sound because the only caller parses with
 * `JSON.parse`, whose output cannot contain `undefined` — the value that
 * separates the strict type from `JsonValue`.
 */
export function isJsonObject(value: unknown): value is StrictJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The first numeric literal in the draft that would not arrive as written, or
 * `null` when every number survives the trip.
 *
 * `isSerializableJson` catches a literal too large to represent at all —
 * `1e400` parses to `Infinity` and writes back as `null`. This catches the
 * quieter one: `{"id":9007199254740993}` parses to `…992`, and
 * `{"id":1000000000000000000001}` parses to `1e21` and is written back as
 * `1e+21`. Either way the editor shows digits the wire will not carry.
 * Snowflake-style ids are the realistic case.
 *
 * It reads the **source text**, which is the only place the answer exists: the
 * parsed number has already lost whatever it lost, so nothing about its value
 * distinguishes `1000000000000000000001` from `1e21`. An earlier attempt
 * inferred it from `String(value)` and was wrong in both directions — it
 * refused `2^54` (written in full and exactly representable) and accepted every
 * full-form literal at or above 1e21, where JS switches to exponent form.
 *
 * Only integer literals written out in full are checked for lost digits. An
 * exponent or a fraction is a double by nature and is sent as the double it
 * parsed to, so nothing is lost between typing and sending — and `{"n":1e308}`
 * stays acceptable, which `parseJsonObjectDraft`'s own tests pin. The two
 * exceptions are checked in every spelling: negative zero, where the loss
 * happens on the way *out*, and underflow, where a nonzero literal parses to
 * zero on the way in.
 */
export function findUnsendableNumberLiteral(text: string): string | null {
  for (const literal of jsonNumberLiterals(text)) {
    // Negative zero, in any spelling — `-0`, `-0.0`, `-0e1`. It is represented
    // exactly, so the digit comparison below has nothing to say about it, but
    // `JSON.stringify` writes it as `0`: the sign is lost on the way out.
    if (Object.is(Number(literal), -0)) return literal;
    // Underflow: a literal with a nonzero mantissa that parses to zero anyway,
    // `1e-400` being the shape of it. The digit comparison skips it for being
    // exponent-form, and it is not negative zero, so nothing else here sees a
    // document that says one number and sends none of it.
    if (Number(literal) === 0 && /[1-9]/.test(mantissaOf(literal))) {
      return literal;
    }
    if (!/^-?\d+$/.test(literal)) continue;
    // BigInt on both sides, so the comparison is exact: `Number(literal)` is an
    // integer-valued double, and converting it back shows what survived.
    if (BigInt(literal) !== BigInt(Number(literal))) return literal;
  }
  return null;
}

/**
 * The part of a numeric literal before its exponent — `1` of `1e-400`, `-0.0`
 * of `-0.0e5`. Whether it holds a nonzero digit is what separates a literal
 * that underflowed to zero from one that was written as zero.
 */
function mantissaOf(literal: string): string {
  return literal.split(/[eE]/)[0];
}

/** Matches one JSON number token, anchored where the scan currently stands. */
const JSON_NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/**
 * The numeric literals of a JSON document, in source order, skipping anything
 * inside a string.
 *
 * The string-skipping is the whole reason this is a scanner rather than a
 * regex over the text: `{"id":"9007199254740993"}` carries those digits as a
 * *string*, which is sent back exactly as written and must not be refused.
 * Object keys are strings too, so they are skipped by the same rule.
 */
function* jsonNumberLiterals(text: string): Generator<string> {
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      index = readStringToken(text, index).next;
      continue;
    }
    if (char === "-" || (char >= "0" && char <= "9")) {
      JSON_NUMBER.lastIndex = index;
      const match = JSON_NUMBER.exec(text);
      /* v8 ignore next -- the sticky pattern always matches from a digit or a
         `-`, which is the only way this branch is entered. */
      if (!match) break;
      yield match[0];
      index = JSON_NUMBER.lastIndex;
      continue;
    }
    index += 1;
  }
}

/**
 * Read one JSON string token starting at the opening quote.
 *
 * Returns where the token ends and its raw source, escapes intact — the caller
 * decodes only when it needs the *value*, which for a key it does: `"a"` and
 * `"\u0061"` name the same member, so comparing the raw forms would miss a
 * duplicate written the second way.
 *
 * Shared by both scanners here so the escape handling — a backslash consumes
 * the next character, including a closing quote — is written once.
 */
function readStringToken(
  text: string,
  start: number,
): { raw: string; next: number } {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (char === '"') break;
  }
  return { raw: text.slice(start, index), next: index };
}

/**
 * The first object member name this document declares twice, or `null`.
 *
 * `JSON.parse` accepts duplicate names and keeps the last silently, so
 * `{"role":"user","role":"admin"}` becomes `{"role":"admin"}` — a document that
 * renders, and submits, as *less* than it says. In a read-only view that is the
 * Inspector hiding what the server sent; in a draft it is the editor showing
 * more than the wire will carry. Neither is acceptable, and nothing else here
 * detects it, because by the time `JSON.parse` returns the evidence is gone.
 *
 * Scoped per object, so `{"a":{"a":1}}` and `[{"a":1},{"a":2}]` are fine — the
 * repeat has to be within one set of braces.
 */
export function findDuplicateObjectKey(text: string): string | null {
  // One frame per open brace or bracket; `null` marks an array, whose members
  // are not named and so cannot collide.
  const stack: (Set<string> | null)[] = [];
  let expectKey = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const { raw, next } = readStringToken(text, index);
      const frame = stack[stack.length - 1];
      if (expectKey && frame) {
        let name: string;
        try {
          name = JSON.parse(raw) as string;
        } catch {
          // An unterminated string at the end of a half-typed draft. There is
          // no key here to compare, and the parse will report the real problem.
          return null;
        }
        if (frame.has(name)) return name;
        frame.add(name);
        expectKey = false;
      }
      index = next;
      continue;
    }
    if (char === "{") {
      stack.push(new Set());
      expectKey = true;
    } else if (char === "[") {
      stack.push(null);
      expectKey = false;
    } else if (char === "}" || char === "]") {
      stack.pop();
      expectKey = false;
    } else if (char === ",") {
      // Only an object's separator introduces a name; an array's does not.
      expectKey = stack[stack.length - 1] != null;
    }
    index += 1;
  }
  return null;
}

/** The message every draft parser uses for {@link findDuplicateObjectKey}. */
export function duplicateKeyError(key: string): string {
  return `\`${key}\` appears twice in the same object — JSON keeps only the last, so part of this would not be sent`;
}

/**
 * The message every draft parser uses for
 * {@link findUnsendableNumberLiteral}.
 *
 * Names the literal rather than the rule, because the rule is two rules: a
 * whole number can lose digits on the way in, and a negative zero loses its
 * sign on the way out. Naming what is wrong with *this* document is more use
 * than either explanation, and it is how the duplicate-key message reads too.
 */
export function unsendableNumberError(literal: string): string {
  return `\`${literal}\` would not arrive as written — it changes when serialized, so a different value would be sent`;
}

/**
 * Read a JSON-object editor's draft text.
 *
 * Empty text is the object `{}` rather than an error — clearing the box is how
 * "send nothing" is spelled, and an empty editor wearing a red error would read
 * as broken.
 *
 * The two failure modes are reported separately because they are different
 * mistakes: text that is not JSON at all is usually mid-edit, while text that
 * is valid JSON but not an object (`[1,2]`, `"a"`, `42`) is a shape the caller
 * cannot use no matter how finished it is.
 *
 * Lives in `utils` rather than beside its component because it is a pure
 * transform — and because exporting it from the component's module trips
 * `react-refresh/only-export-components`.
 */
export function parseJsonObjectDraft(text: string): JsonObjectDraft {
  if (text.trim() === "") return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON — changes are not applied" };
  }
  if (!isJsonObject(parsed)) {
    return {
      ok: false,
      error: "Must be a JSON object (`{ … }`) — changes are not applied",
    };
  }
  // `JSON.parse` accepts numeric literals it cannot represent: `1e400` parses
  // to `Infinity`, which `JSON.stringify` then writes as `null`. Accepting it
  // here would show the user one value and send another.
  if (!isSerializableJson(parsed)) {
    return {
      ok: false,
      error:
        "Numbers must be finite — a value like `1e400` overflows and would be sent as null",
    };
  }
  const unsendable = findUnsendableNumberLiteral(text);
  if (unsendable !== null) {
    return { ok: false, error: unsendableNumberError(unsendable) };
  }
  const duplicate = findDuplicateObjectKey(text);
  if (duplicate !== null) {
    return { ok: false, error: duplicateKeyError(duplicate) };
  }
  return { ok: true, value: parsed };
}
