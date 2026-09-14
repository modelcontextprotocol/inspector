/**
 * RFC 6570 URI Template parsing and expansion, shared by the web and TUI
 * clients (#1919).
 *
 * This lives in `core/` rather than in a client so the web Resources form and
 * the TUI cannot disagree about what a template means. Both derive their form
 * fields from {@link templateVariables} and expand through
 * {@link expandUriTemplate} — the web panel directly, the TUI via
 * `InspectorClient.readResourceFromTemplate`.
 *
 * The **CLI is deliberately not a consumer**: it has no template form, and its
 * `resources/read` passes the already-expanded `--uri` straight to
 * `readResource` (see `clients/cli/src/handlers/run-method.ts`). Nothing here
 * runs for it.
 *
 * ## Why this is not simply `new UriTemplate(t).expand(v)`
 *
 * The SDK's `UriTemplate` is still used, but only to *validate* a template —
 * constructing it is what rejects an unclosed expression. Its expander is not,
 * because it is incomplete in ways a form makes visible: a form has to *name*
 * the variables it asks the user to fill in, so a parser that mangles a name
 * produces a field nobody can use. Each of these was measured against the
 * pinned SDK, not inferred:
 *
 * | Shape            | SDK behavior                                              |
 * | ---------------- | --------------------------------------------------------- |
 * | `{a,b}`          | raw-joins the values — no encoding, operator prefix dropped |
 * | `{;id}`          | `;` is not in its operator list, so the variable is `;id`  |
 * | `{id:3}`         | the prefix modifier is folded into the name, giving `id:3` |
 * | `{+v}` / `{#v}`  | `encodeURI` mangles reserved `[`/`]` and double-encodes `%` |
 * | `{v}`            | `encodeURIComponent` leaves the sub-delims `!'()*` bare     |
 *
 * An earlier revision delegated the shapes the SDK got right and took over only
 * the rest. That split is gone: once the encoders themselves differed, the two
 * paths would have encoded the *same value* differently depending on whether
 * the expression happened to carry a modifier. One expander, one set of rules.
 */

import { UriTemplate } from "@modelcontextprotocol/client";

/**
 * The RFC 6570 operators.
 *
 * `;` is here but **not** in the SDK's own list, which is why `{;id}` parses
 * there as a variable literally named `;id`. Order matters only in that each is
 * a distinct single character; the first match wins.
 */
const OPERATORS = ["+", "#", ".", "/", ";", "?", "&"] as const;

/**
 * Operators whose expansion omits cleanly when the variables in it are
 * undefined — the whole expression, separator and all, simply disappears and
 * what is left is still a well-formed URI naming a real (broader) resource.
 *
 * The remaining operators — `""` (simple) and `+` (reserved) — interpolate the
 * value into the *middle* of the URI, so omitting one leaves an empty path
 * segment rather than a shorter URI: measured against the pinned SDK,
 * `file:///users/{userId}/profile` expands to `file:///users//profile` and
 * `x://a/{+path}` to `x://a/`, both of which name a different resource. Those
 * are the ones a form must require before allowing a read.
 *
 * `#` is in the omittable set on the same measurement: `x://a{#frag}` with no
 * `frag` expands to exactly `x://a`. A fragment is optional by construction.
 */
const OMITTABLE_OPERATORS = new Set(["#", ".", "/", ";", "?", "&"]);

/** Operators that expand to `name=value` pairs rather than bare values. */
const NAMED_OPERATORS = new Set([";", "?", "&"]);

/** A single variable reference inside an expression, e.g. `id` or `id:3`. */
export interface VarSpec {
  name: string;
  /**
   * Absent (i.e. conforming) unless the name needed the `-`/`~` tolerance to
   * parse — see {@link TOLERATED_VARCHAR}. Present and `false` marks a name RFC
   * 6570's own conformance suite would reject, which the Inspector expands
   * anyway because real servers publish such names and the SDK's matcher
   * accepts them.
   */
  conforming?: false;
  /**
   * The RFC 6570 prefix modifier (`{id:3}`), a maximum length in *characters*.
   * Applied to the value before percent-encoding, per §3.2.1.
   */
  maxLength?: number;
}

interface TemplateLiteral {
  kind: "literal";
  text: string;
}

interface TemplateExpression {
  kind: "expression";
  /** The expression including its braces, e.g. `{?topic}`. */
  source: string;
  /** The RFC 6570 operator, or `""` for a simple expression. */
  operator: string;
  /** The variable references, in order. */
  varspecs: VarSpec[];
  /** Bare variable names, `*` and any `:length` modifier stripped. */
  names: string[];
  /**
   * True when a varspec is not one RFC 6570 admits — an out-of-grammar modifier
   * (`{id:abc}`) or an empty member (`{}`, `{a,}`); see {@link parseVarSpec}.
   * Strict expansion rejects such a template and the form withholds the read,
   * while *discovery* stays lenient so the panel still renders whatever names
   * the template does declare rather than going blank.
   */
  invalid: boolean;
}

export type TemplatePart = TemplateLiteral | TemplateExpression;

export interface TemplateVariable {
  name: string;
  /** The operator of the expression the variable was first seen in. */
  operator: string;
  /**
   * `false` when the name is outside RFC 6570's `varchar` and only parsed via
   * the documented `-`/`~` tolerance (see {@link TOLERATED_VARCHAR}). A caller
   * wanting RFC-exact behavior refuses on this rather than re-deriving the
   * grammar; the Inspector itself expands such a template.
   */
  conforming: boolean;
  /**
   * True when this variable appears in at least one expression that cannot be
   * omitted without changing the URI's structure — see
   * {@link OMITTABLE_OPERATORS}. Drives the form's "Optional" marker.
   *
   * It does **not** mean "the user must fill this field in". Requiredness is a
   * property of the *expression*: RFC 6570 drops undefined names from a
   * multi-name expression, so `{a,b}` with only `a` filled expands to `a`'s
   * value. Gate submission on {@link hasRequiredValues} over
   * {@link requiredGroups}, never by testing this flag per variable.
   */
  required: boolean;
}

/**
 * RFC 6570's `varchar`, exactly: `ALPHA / DIGIT / "_" / pct-encoded`.
 *
 * This is the *conformance* production, kept unwidened so the grammar in the
 * code says what the RFC says. What the parser goes on to **accept** is one
 * tier wider — see {@link TOLERATED_VARCHAR}.
 */
const VARCHAR = String.raw`(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})`;

/**
 * The two characters accepted in a name beyond `varchar`, as an explicitly
 * separate tier rather than a widened grammar.
 *
 * `-` and `~` are RFC 3986 *unreserved*, so they satisfy the property that
 * actually matters at expansion time: a name is the one thing emitted into the
 * URI **without** encoding (`;`, `?` and `&` write `name=value`), and these two
 * need none. RFC 6570's own conformance suite rejects `{~thing}` and
 * `{default-graph-uri}`, so a template using them is non-conforming — but real
 * servers publish hyphenated names, and the SDK's matcher round-trips them
 * (`match()` compiles the hyphen literally). Refusing to read a resource that
 * demonstrably works is a worse failure for a debugging tool than expanding a
 * name one character outside the production.
 *
 * So the tolerance is *labelled* rather than hidden: a varspec matching only
 * this tier is parsed with `conforming: false`, surfaced on
 * {@link TemplateVariable}, and a caller that wants RFC-exact behavior can
 * refuse on that flag without re-implementing the grammar.
 */
const TOLERATED_VARCHAR = String.raw`[-~]`;

/** `varname = varchar *( ["."] varchar )` — a dot separates, never leads or doubles. */
function varnameGrammar(varchar: string): string {
  return `${varchar}(?:\\.?${varchar})*`;
}

/**
 * RFC 6570's `varspec`: a `varname` with at most one trailing modifier, either
 * the explode `*` or a `:max-length`, never both.
 *
 * `max-length` is `%x31-39 0*3DIGIT` — 1 to 9999, no leading zero — so `{id:}`,
 * `{id:0}`, `{id:abc}` and `{id:10000}` are invalid *templates*, not templates
 * with an ignorable modifier.
 *
 * Anchoring the whole varspec is what rejects the shapes a looser "strip the
 * `*`, split on `:`" pass waves through. Measured before it landed, each
 * expanded rather than being refused:
 *
 * | Varspec   | Was                  | Why it is invalid                   |
 * | --------- | -------------------- | ----------------------------------- |
 * | `{*id}`   | name `id`            | explode is a *trailing* modifier    |
 * | `{id*:3}` | name `id`, truncated | the two modifiers are exclusive     |
 * | `{ id }`  | name `id`            | whitespace is not a `varchar`       |
 * | `{a b}`   | name `a b`           | ditto — and it emits into the URI   |
 */
const MODIFIER = String.raw`(?:\*|:([1-9][0-9]{0,3}))?`;
const CONFORMING_VARSPEC = new RegExp(
  `^(${varnameGrammar(VARCHAR)})${MODIFIER}$`,
);
const TOLERATED_VARSPEC = new RegExp(
  `^(${varnameGrammar(`(?:${VARCHAR}|${TOLERATED_VARCHAR})`)})${MODIFIER}$`,
);

function parseVarSpec(raw: string): VarSpec | "invalid" {
  const conforming = CONFORMING_VARSPEC.exec(raw);
  const match = conforming ?? TOLERATED_VARSPEC.exec(raw);
  if (match === null) return "invalid";
  const [, name, maxLength] = match;
  return {
    name,
    ...(maxLength === undefined ? {} : { maxLength: +maxLength }),
    ...(conforming === null ? { conforming: false } : {}),
  };
}

/**
 * Splits a template into literal runs and expressions.
 *
 * An unclosed `{` yields a trailing literal, which is what makes the callers
 * below degrade to "render no inputs, show the template verbatim" rather than
 * throw at the user.
 */
export function parseUriTemplate(uriTemplate: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let literal = "";
  let i = 0;

  while (i < uriTemplate.length) {
    if (uriTemplate[i] !== "{") {
      literal += uriTemplate[i];
      i += 1;
      continue;
    }
    const end = uriTemplate.indexOf("}", i);
    if (end === -1) {
      // Unclosed expression — the rest is not a template, treat it as text.
      literal += uriTemplate.slice(i);
      break;
    }
    if (literal) {
      parts.push({ kind: "literal", text: literal });
      literal = "";
    }
    const body = uriTemplate.slice(i + 1, end);
    const operator = OPERATORS.find((op) => body.startsWith(op)) ?? "";
    const parsed = body.slice(operator.length).split(",").map(parseVarSpec);
    const varspecs = parsed.filter(
      (spec): spec is VarSpec => spec !== "invalid",
    );
    parts.push({
      kind: "expression",
      source: uriTemplate.slice(i, end + 1),
      operator,
      varspecs,
      names: varspecs.map((spec) => spec.name),
      invalid: parsed.includes("invalid"),
    });
    i = end + 1;
  }

  if (literal) parts.push({ kind: "literal", text: literal });
  return parts;
}

/**
 * The variables a form should render an input for, in template order and
 * deduplicated by name. A name appearing under more than one operator is
 * required if *any* of its occurrences is.
 */
export function templateVariables(uriTemplate: string): TemplateVariable[] {
  const byName = new Map<string, TemplateVariable>();

  for (const part of parseUriTemplate(uriTemplate)) {
    if (part.kind !== "expression") continue;
    const required = !OMITTABLE_OPERATORS.has(part.operator);
    // Iterating the varspecs (rather than the names, re-scanning the varspecs
    // for each) keeps discovery linear. A template is server-controlled and the
    // SDK admits one up to 1 MB, so a single expression can carry thousands of
    // short comma-separated names -- and this runs on the render thread.
    for (const spec of part.varspecs) {
      const { name } = spec;
      const conforming = spec.conforming !== false;
      const existing = byName.get(name);
      if (existing) {
        existing.required = existing.required || required;
        existing.conforming = existing.conforming && conforming;
      } else {
        byName.set(name, {
          name,
          operator: part.operator,
          required,
          conforming,
        });
      }
    }
  }

  return [...byName.values()];
}

/**
 * The variable names of each expression that cannot be omitted, in template
 * order — one entry per expression, not per variable.
 *
 * This is deliberately *not* folded onto {@link TemplateVariable}. A name can
 * appear in several expressions with different operators, and each required
 * expression has to be satisfied on its own: in `x{?a}{?b}{a,b}` the only
 * required expression is `{a,b}`, which either `a` or `b` satisfies (the SDK
 * expands that template with just `a` to `x?a=11`), while a per-variable model
 * that kept only the first occurrence's group would mark both names required
 * with singleton groups and refuse it. And in `{a,b}{a,c}` — two required
 * expressions sharing `a` — filling `b` and `c` satisfies both, which no
 * per-variable flag can express at all.
 */
export function requiredGroups(uriTemplate: string): string[][] {
  const groups: string[][] = [];
  for (const part of parseUriTemplate(uriTemplate)) {
    if (part.kind !== "expression") continue;
    if (OMITTABLE_OPERATORS.has(part.operator)) continue;
    // An expression naming no variable at all (`x://{}`) is a malformed
    // template, which {@link tryExpandUriTemplate} refuses with that as the
    // reason. Emitting an empty group here too would gate the form a second
    // time on a condition nothing can satisfy, and the "any one of" message
    // built from it would name no fields.
    if (part.names.length === 0) continue;
    // Deduplicated within the expression: `{a,a}` is one requirement named
    // twice, not two names either of which would do. Left as-is it read as a
    // shared group everywhere downstream -- the TUI's `length === 1` test
    // marked `a` optional while its submit guard still refused a blank, and the
    // web panel offered the useless hint "Any one of: a, a".
    groups.push([...new Set(part.names)]);
  }
  return groups;
}

/**
 * The required expressions `values` does **not** satisfy — none of their names
 * filled in — in template order.
 *
 * Exported so a caller that has to *name* the missing fields derives them from
 * the same pass that decides whether anything is missing at all. The TUI built
 * its "Missing required template variable(s): …" list with its own bare
 * `values[name]` filter, which for a variable legitimately named `constructor`
 * or `toString` found `Object.prototype`'s member and judged the group
 * satisfied — so {@link hasRequiredValues} blocked the submit while the message
 * listed nothing.
 */
export function unmetRequiredGroups(
  groups: string[][],
  values: Record<string, string>,
): string[][] {
  return groups.filter(
    (names) =>
      !names.some((name) => (readValue(values, name) ?? "").length > 0),
  );
}

/**
 * Whether `values` supplies everything expansion structurally needs: every
 * required expression has at least one of its names filled in.
 */
export function hasRequiredValues(
  groups: string[][],
  values: Record<string, string>,
): boolean {
  return unmetRequiredGroups(groups, values).length === 0;
}

/**
 * Reads a variable, ignoring anything inherited from `Object.prototype`.
 *
 * `toString`, `constructor`, `valueOf` and `__proto__` are all valid RFC 6570
 * variable names (`varname` allows ALPHA / DIGIT / `_` / pct-encoded), and a
 * plain object lookup finds the prototype's member for every one of them. A
 * bare `values[name] !== undefined` therefore reports a *blank* `{?toString}`
 * as supplied and expands a function body into the URI; `hasRequiredValues`
 * likewise saw `constructor` as satisfied because `Object.length` is 1.
 */
function readValue(
  values: Record<string, string>,
  name: string,
): string | undefined {
  return Object.hasOwn(values, name) ? values[name] : undefined;
}

/**
 * Drops empty entries so an untouched optional field reads as *undefined*
 * (the expression disappears) rather than as the empty string (which would
 * expand to a valueless `?topic=`).
 *
 * **A UI-boundary concern, deliberately not part of the expander.** RFC 6570
 * distinguishes an undefined variable (the expression is omitted) from one
 * defined as `""` (it expands — `x{?q}` gives `x?q=`, `x{;q}` gives `x;q`), and
 * collapsing the two inside {@link expandUriTemplateStrict} made those URIs
 * unrequestable through any caller, `readResourceFromTemplate` included.
 *
 * What forces the collapse is a *form*: both clients seed every declared
 * variable with `""`, and a text input cannot express "defined but empty", so
 * an untouched field is indistinguishable from a deliberately empty one. That
 * is a property of the form, not of the template — so each form applies this
 * on its way in, and the expander honors exactly what it is handed.
 */
export function definedValues(
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value.length > 0),
  );
}

/**
 * The characters RFC 6570 leaves alone under the `+` and `#` operators:
 * RFC 3986 *unreserved* plus *reserved* (gen-delims and sub-delims).
 */
const ALLOW_RESERVED = /[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]/gu;

/**
 * The `allow-reserved` value encoding of RFC 6570 §3.2.1, used by `+` and `#`.
 *
 * The SDK reaches for `encodeURI` here, which is close but wrong twice over,
 * and both cases corrupt the URI rather than merely over-escaping it:
 *
 * - It escapes `[` and `]`, which are *reserved* and must survive — so an IPv6
 *   literal `[::1]` becomes `%5B::1%5D`.
 * - It escapes `%`, so an already-encoded value is double-encoded: `%2F`
 *   becomes `%252F`, and the server sees a literal "%2F" rather than a slash.
 *
 * The spec instead keeps existing pct-triplets intact, which is what the split
 * below does: odd chunks are whole `%XX` triplets and pass through untouched,
 * even chunks are scanned for anything outside the allowed set. A lone `%` is
 * not a triplet, so it lands in an even chunk and is correctly encoded to
 * `%25`. The `u` flag makes the class match by code point, so an astral
 * character is handed to `encodeURIComponent` whole rather than as surrogates.
 */
/**
 * Percent-encodes a template's **literal** text (RFC 6570 §3.1).
 *
 * A literal may legally contain non-ASCII (`ucschar`), but expansion must emit
 * it pct-encoded: the conformance case `café/{var}` expands to
 * `caf%C3%A9/value`. Literals used to be copied through verbatim, so such a
 * template went out with raw UTF-8 in the path — and since this module replaced
 * the SDK's expander for both clients, nothing else was going to encode it. (The
 * pinned SDK does not either; measured, it also returns `café/value`.)
 *
 * The rule is the same one {@link encodeAllowReserved} implements — keep
 * unreserved, keep reserved (a literal's `/`, `?` and `#` are *structure*, not
 * data), keep an existing pct-triplet, encode everything else — with one
 * exception: a brace passes through.
 *
 * A brace is not a legal literal character, so it reaches this function only
 * from a **malformed** template, where {@link parseUriTemplate} treats an
 * unclosed `{` as trailing text. That case degrades to "show the template as
 * the server wrote it", and encoding the brace to `%7B` would make the
 * degradation unreadable — a string resembling neither the template nor
 * anything the server could match.
 */
export function encodeLiteral(text: string): string {
  return text
    .split(/([{}])/g)
    .map((chunk, index) =>
      index % 2 === 1 ? chunk : encodeAllowReserved(chunk),
    )
    .join("");
}

function encodeAllowReserved(value: string): string {
  return value
    .split(/(%[0-9A-Fa-f]{2})/g)
    .map((chunk, index) =>
      index % 2 === 1
        ? chunk
        : chunk.replace(ALLOW_RESERVED, (char) => encodeURIComponent(char)),
    )
    .join("");
}

/**
 * Percent-encodes everything outside RFC 3986's *unreserved* set, which is what
 * every operator except `+` and `#` calls for.
 *
 * `encodeURIComponent` alone is not that set: it leaves `!`, `'`, `(`, `)` and
 * `*` unescaped. Those are sub-delims, not unreserved, so RFC 6570 requires
 * them encoded for simple, label, path, matrix and query expansion. They are
 * substituted afterwards rather than hand-rolled, so `encodeURIComponent` still
 * does the UTF-8 work for everything else.
 */
const FORCE_ENCODED: Record<string, string> = {
  "!": "%21",
  "'": "%27",
  "(": "%28",
  ")": "%29",
  "*": "%2A",
};

function encodeUnreserved(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => FORCE_ENCODED[char],
  );
}

/**
 * The two operators whose expansion preserves RFC 3986 *reserved* characters
 * and existing pct-triplets rather than encoding them (RFC 6570 §3.2.3, §3.2.4).
 */
function allowsReserved(operator: string): boolean {
  return operator === "+" || operator === "#";
}

/** Encodes one value for its operator: reserved characters survive `+` and `#`. */
function encodeValue(value: string, operator: string): string {
  return allowsReserved(operator)
    ? encodeAllowReserved(value)
    : encodeUnreserved(value);
}

/**
 * One unit a prefix modifier counts: a code point, a pct-encoded octet, or a
 * whole pct-encoded UTF-8 *sequence*.
 *
 * The sequence alternatives are what stop a multi-octet character being cut in
 * half. `%C3%A9` is one character — `é` — so `{+v:1}` over `%C3%A9x` must keep
 * both octets; counting per triplet returned `%C3`, a lone lead byte that
 * decodes to nothing. The lead byte announces the length (RFC 3629: `C2-DF`
 * two octets, `E0-EF` three, `F0-F4` four) and each continuation is `80-BF`,
 * so a well-formed sequence is recognizable without decoding.
 *
 * Order matters: longest first, so a four-octet sequence is not matched as a
 * two-octet one followed by loose triplets.
 *
 * The lead-byte ranges are RFC 3629's **well-formed** ones, not merely the
 * length-announcing prefixes: `C2-DF` (so the overlong `%C0%80` is excluded),
 * `E0` only with `A0-BF`, `ED` only with `80-9F` (excluding UTF-16
 * surrogates), `F0` only with `90-BF`, `F4` only with `80-8F` (nothing past
 * U+10FFFF). An earlier revision accepted the whole `C0-DF`/`E0-EF`/`F0-F4`
 * space and so grouped those invalid sequences as one character — the
 * opposite of the fallback this comment promised.
 *
 * A malformed sequence — an excluded lead byte, too few continuations, or a
 * stray continuation — now matches no sequence alternative and falls through
 * to the single-triplet rule, which is the conservative behavior: it counts as
 * more units, so truncation keeps less rather than emitting something that was
 * never in the value.
 */
const CONTINUATION = String.raw`%[89AB][0-9A-F]`;
/** RFC 3629 well-formed sequences only — `C2-DF`, and the restricted second
 *  bytes that exclude overlongs (`E0%A0-BF`, `F0%90-BF`), UTF-16 surrogates
 *  (`ED%80-9F`) and anything past U+10FFFF (`F4%80-8F`). */
const UTF8_SEQUENCE = [
  String.raw`(?:%F0%(?:9[0-9A-F]|[AB][0-9A-F])|%F[1-3]${CONTINUATION}|%F4%8[0-9A-F])${CONTINUATION}${CONTINUATION}`,
  String.raw`(?:%E0%[AB][0-9A-F]|%E[1-9ABCEF]${CONTINUATION}|%ED%[89][0-9A-F])${CONTINUATION}`,
  String.raw`%(?:C[2-9A-F]|D[0-9A-F])${CONTINUATION}`,
].join("|");
const PREFIX_UNIT = new RegExp(`${UTF8_SEQUENCE}|%[0-9A-F]{2}|[\\s\\S]`, "giu");

/**
 * Splits a value into the units a prefix modifier counts.
 *
 * RFC 6570 §2.4.1 counts *characters*, and is explicit that a pct-encoded
 * triplet counts as a single one — so `{+v:5}` over `%61%62%63%64%65%66` stops
 * after five whole triplets. Splitting on code points cut the sixth in half,
 * and the orphaned `%6` was no longer a triplet, so `encodeAllowReserved`
 * correctly escaped its `%`: the value went out as `%61%256`, a byte the caller
 * never asked for.
 *
 * The rule is **operator-independent**, which is a correction of the narrower
 * version this shipped first. Grouping only under `+`/`#` made the same input
 * mean two different things — `%61` an indivisible character under `+`, three
 * loose characters under a simple expression — and produced the matching
 * defect one operator over: `{v:1}` over `%61%62` kept just the `%` and emitted
 * `%25`, a truncation to a character that was never in the value. What the
 * operator decides is how a unit is *encoded* afterwards (a simple expansion
 * still escapes the `%`, so the retained `%61` goes out as `%2561`), not what
 * counts as one.
 *
 * The `u` flag makes the final alternative match by code point, so an astral
 * character is one unit rather than a surrogate pair that truncation could
 * split.
 */
function prefixUnits(value: string): string[] {
  return value.match(PREFIX_UNIT) ?? [];
}

/**
 * Applies a prefix modifier, then encodes.
 *
 * Truncation counts the units {@link prefixUnits} defines rather than using
 * `String.prototype.slice`, which counts UTF-16 code units and so can cut an
 * astral character in half and yield a lone surrogate.
 */
function renderValue(value: string, spec: VarSpec, operator: string): string {
  const truncated =
    spec.maxLength === undefined
      ? value
      : prefixUnits(value).slice(0, spec.maxLength).join("");
  return encodeValue(truncated, operator);
}

/**
 * Expands one expression per RFC 6570. Returns "" if no name has a value.
 *
 * Exported for the web client's URI *preview*, which expands the expressions
 * the user has filled while leaving the rest standing as written — it cannot
 * go through {@link expandParts}, which expands all or nothing, and routing a
 * half-rewritten template string back through the parser would mean smuggling
 * a placeholder past {@link encodeLiteral}.
 */
export function expandTemplateExpression(
  part: TemplateExpression,
  values: Record<string, string>,
): string {
  // The value is carried through the filter rather than re-read afterwards, so
  // the "is it defined" test and the read cannot disagree — and so nothing
  // downstream needs a non-null assertion to convince the compiler.
  const present = part.varspecs.flatMap((spec) => {
    const value = readValue(values, spec.name);
    return value === undefined ? [] : [{ spec, value }];
  });
  if (present.length === 0) return "";

  const { operator } = part;

  if (NAMED_OPERATORS.has(operator)) {
    const pairs = present.map(({ spec, value }) => {
      const rendered = renderValue(value, spec, operator);
      // RFC 6570 §3.2.7: the matrix operator drops the `=` for an empty value,
      // so `x{;q}` with `q = ""` is `x;q` — while `?`/`&` keep it (`x?q=`).
      // Both are only reachable now that the expander honors a defined-but-
      // empty value instead of collapsing it into "undefined"; see
      // `definedValues` for where that collapse legitimately happens instead.
      return operator === ";" && rendered.length === 0
        ? spec.name
        : `${spec.name}=${rendered}`;
    });
    // `;` repeats its separator per pair; `?`/`&` join with `&`.
    return operator === ";"
      ? `;${pairs.join(";")}`
      : `${operator}${pairs.join("&")}`;
  }

  const rendered = present.map(({ spec, value }) =>
    renderValue(value, spec, operator),
  );

  switch (operator) {
    case "#":
      return `#${rendered.join(",")}`;
    case ".":
      return `.${rendered.join(".")}`;
    case "/":
      return `/${rendered.join("/")}`;
    // "" and "+" — a bare comma-joined list, no prefix.
    default:
      return rendered.join(",");
  }
}

/**
 * Expands a whole parsed template.
 *
 * Each expression is expanded **independently**, which is what RFC 6570
 * specifies — expansion carries no cross-expression state. The SDK instead
 * tracks whether a query expression has already emitted and rewrites a later
 * `{?two}`'s leading `?` to `&`. That looks friendlier and is wrong: measured
 * against the pinned SDK, `x{?one}{?two}` expands to `x?one=1&two=2`, and
 * `UriTemplate.match` on that same template *rejects* it — `match("x?one=1&two=2")`
 * is `null`, while `match("x?one=1?two=2")` returns both variables. So the
 * rewrite emits a URI the advertised template cannot match, which is precisely
 * the failure #1919 is about, one level up.
 *
 * A server that wants a continuation advertises it: `{?one}{&two}` expands to
 * `x?one=1&two=2` and matches. Producing that shape is the server's choice to
 * declare, not ours to infer.
 */
export function expandParts(
  parts: TemplatePart[],
  values: Record<string, string>,
): string {
  return parts
    .map((part) =>
      part.kind === "literal"
        ? encodeLiteral(part.text)
        : expandTemplateExpression(part, values),
    )
    .join("");
}

/**
 * Expands a template against the supplied values per RFC 6570 — percent-encoding
 * each value according to its operator, and omitting an expression none of
 * whose variables are defined. **Throws** on a template that is not valid.
 *
 * A key present with an empty string is *defined*, and expands: `x{?q}` gives
 * `x?q=` and `x{;q}` gives `x;q`. Only an absent key omits its expression. A
 * form that cannot tell "untouched" from "deliberately empty" drops its blanks
 * with {@link definedValues} before calling — which is where that judgement
 * belongs, since it is a fact about the form rather than about the template.
 *
 * Every expression is expanded by {@link expandParts}; the SDK's `UriTemplate`
 * is constructed only because that is what rejects an unclosed expression, and
 * callers such as `readResourceFromTemplate` wrap the error it throws. Its own
 * `expand` is deliberately unused — see the module comment for the five shapes
 * it gets wrong.
 *
 * Its constructor is not a complete validator either: it accepts `{id:abc}`,
 * whose modifier is not RFC 6570's `max-length` production. Treating that as a
 * plain `{id}` would send a URI the server never advertised, so the owned
 * parser's verdict is checked too.
 */
export function expandUriTemplateStrict(
  uriTemplate: string,
  values: Record<string, string>,
): string {
  const sdk = sdkTemplateError(uriTemplate);
  if (sdk) throw new Error(sdk);

  // Parsed ONCE and reused for validation, the name list and the expansion --
  // the template is server-controlled and may be up to 1 MB, so re-parsing it
  // per step is real work on the render thread.
  const parts = parseUriTemplate(uriTemplate);

  const invalid = partsError(uriTemplate, parts);
  if (invalid) throw new Error(invalid);

  const tooLong = valueLengthError(values, declaredNames(parts));
  if (tooLong) throw new Error(tooLong);

  return expandParts(parts, values);
}

/**
 * Why `uriTemplate` cannot be expanded **at all**, independent of any values,
 * or `null` if it can.
 *
 * Exported because the preview needs the same verdict before it expands
 * anything: it goes expression by expression, so without this it happily
 * rendered `x://1}/2` for `x://{a}}/{b}` — a template whose stray `}` makes
 * every read refuse, i.e. a URI the form it sits in can never send.
 *
 * Three sources, deliberately in one place so the two callers cannot drift:
 * the SDK's constructor (an unclosed `{`, and its template-length,
 * expression-count and variable-name-length limits), a brace surviving in a
 * literal, and a varspec this module's own grammar rejects.
 */
export function templateError(uriTemplate: string): string | null {
  return (
    sdkTemplateError(uriTemplate) ??
    partsError(uriTemplate, parseUriTemplate(uriTemplate))
  );
}

/**
 * What the SDK's constructor rejects: an unclosed `{`, and its template-length
 * (1e6), expression-count (1e4) and variable-name-length (1e6) limits.
 */
function sdkTemplateError(uriTemplate: string): string | null {
  try {
    new UriTemplate(uriTemplate);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** What this module's own grammar rejects, given the already-parsed template. */
function partsError(uriTemplate: string, parts: TemplatePart[]): string | null {
  // A brace left in a literal is an unmatched one, and it is not a legal
  // literal character. The SDK's constructor rejects an unclosed `{` but reads
  // a stray `}` as text, and this parser does the same, so without this check
  // `x://a}` expanded to itself -- a "URI" carrying a brace, with the panel
  // happily enabling the read. Both halves are now refused the same way.
  const stray = parts.find(
    (part) => part.kind === "literal" && /[{}]/.test(part.text),
  );
  if (stray) {
    return `Unmatched brace in "${uriTemplate}" — an expression must be a complete {…}.`;
  }

  const bad = parts.find((part) => part.kind === "expression" && part.invalid);
  if (bad) {
    return `Invalid RFC 6570 varspec in "${uriTemplate}": ${
      bad.kind === "expression" ? bad.source : ""
    } — each varspec must name a variable, optionally with an explode (*) or a 1-9999 prefix modifier.`;
  }

  return null;
}

/**
 * The pinned SDK's per-value ceiling (`MAX_VARIABLE_LENGTH`, 1e6), enforced
 * here because this module no longer calls `UriTemplate.expand` — which is
 * where that check lived.
 *
 * It is the only guard that moved. Auditing the rest of the SDK's expander
 * against what this replaced: the template-length (1e6), expression-count
 * (1e4) and variable-name-length (1e6) limits all live in `parse()`, which
 * runs from the **constructor** — and {@link expandUriTemplateStrict} still
 * constructs a `UriTemplate`, so those remain enforced by it.
 */
const MAX_VALUE_LENGTH = 1_000_000;

/**
 * The first value exceeding {@link MAX_VALUE_LENGTH}, as a message, or `null`.
 *
 * `names` limits the check to the variables a template actually references,
 * and callers should pass it. RFC 6570 ignores an extra variable, and the SDK
 * path this replaced validated a value only *after* looking one up by declared
 * name — so checking the whole map made an unrelated entry fail a template
 * that never mentions it: `x://{id}` with a valid `id` was refused because
 * some stale megabyte-long key sat beside it in the caller's map.
 *
 * Exported because the *preview* needs the same verdict and cannot get it from
 * {@link expandUriTemplateStrict}: it expands expression by expression, so it
 * would otherwise hand an oversized value straight to the encoders during
 * render — the guard would hold for the read while the UI still froze on the
 * paste that triggered it.
 */
export function valueLengthError(
  values: Record<string, string>,
  names?: Iterable<string>,
): string | null {
  const considered =
    names === undefined ? Object.keys(values) : [...new Set(names)];
  for (const name of considered) {
    const value = readValue(values, name);
    if (value !== undefined && value.length > MAX_VALUE_LENGTH) {
      return `The value for "${name}" exceeds the ${MAX_VALUE_LENGTH}-character limit.`;
    }
  }
  return null;
}

/** The variable names a parsed template references, in order, deduplicated. */
export function declaredNames(parts: TemplatePart[]): string[] {
  return [
    ...new Set(
      parts.flatMap((part) => (part.kind === "expression" ? part.names : [])),
    ),
  ];
}

/**
 * The outcome of an expansion: the URI, or the reason there isn't one.
 *
 * This is what a form gates its submit on. The lenient
 * {@link expandUriTemplate} below is for *display* — it answers with the raw
 * template so a panel can keep rendering — and a caller that mistook that
 * fallback for a URI would issue a `resources/read` for the template itself,
 * literal braces and all. Making the failure a value rather than a string the
 * caller has to recognize is what keeps that from being possible.
 *
 * Failure is not only the malformed-template case: a value carrying an
 * unpaired surrogate has no UTF-8 encoding, so `encodeURIComponent` throws
 * `URIError` on it, and a text input can hold one via paste.
 */
export type TemplateExpansion =
  | { uri: string; error?: undefined }
  | { uri?: undefined; error: string };

/**
 * {@link expandUriTemplateStrict} with the throw turned into a value, for
 * callers that must *decide* rather than degrade — chiefly the web panel, which
 * disables Read Resource and shows the reason instead of sending a URI it knows
 * is wrong.
 */
export function tryExpandUriTemplate(
  uriTemplate: string,
  values: Record<string, string>,
): TemplateExpansion {
  try {
    return { uri: expandUriTemplateStrict(uriTemplate, values) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * {@link expandUriTemplateStrict}, but falling back to the raw template string
 * instead of throwing.
 *
 * This is the **display** variant, and only that: it runs during render (the
 * URI preview), where a throw would take out the whole panel, and the raw
 * template is the honest thing to show for a template nothing can expand.
 *
 * Do **not** submit what it returns. A caller deciding whether to issue a read
 * uses {@link tryExpandUriTemplate}, whose failure is a value it cannot
 * mistake for a URI; `readResourceFromTemplate` uses the strict variant and
 * wraps the error with the template's name.
 */
export function expandUriTemplate(
  uriTemplate: string,
  values: Record<string, string>,
): string {
  return tryExpandUriTemplate(uriTemplate, values).uri ?? uriTemplate;
}
