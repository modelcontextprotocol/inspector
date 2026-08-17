/**
 * RFC 6570 URI Template discovery, expansion, and preview — shared by every
 * client so a template cannot resolve differently depending on where it is
 * driven from.
 *
 * The web client used to discover variables with `/\{(\w+)\}/g` and expand them
 * with a plain `String.replace`. That only ever saw simple expressions — a
 * query expression like `{?topic}` produced no input at all — and it inserted
 * values verbatim, so a `topic` of `foo/bar` silently became a second path
 * segment instead of `foo%2Fbar` (#1919).
 *
 * These wrap the SDK's `UriTemplate`, correcting the two places its expander
 * departs from RFC 6570 (see `groupMultiNameExpressions` and
 * `unsupportedReason`). Living in `core/` is what makes the correction
 * uniform: the web panel, the TUI's form builder, and
 * `InspectorClient.readResourceFromTemplate` all route through here rather than
 * calling the SDK directly, so web, CLI, and TUI agree on what a template's
 * variables are and on how a value is encoded.
 *
 * Neither helper throws: a template the SDK rejects, or a value it refuses to
 * expand, yields `null` from `expandTemplate` (so the caller can withhold the
 * request) and the raw template from `previewTemplate` (which runs during
 * render, where a throw would take the panel down with it).
 */
import { UriTemplate } from "@modelcontextprotocol/client";

/**
 * Parses `uriTemplate` once so a caller can discover, expand, and preview
 * without re-parsing. Returns `null` when the template is malformed (the SDK
 * throws on, e.g., an unterminated expression) so callers can degrade to
 * rendering the raw string rather than crashing the panel.
 */
function parseTemplate(uriTemplate: string): UriTemplate | null {
  try {
    return new UriTemplate(uriTemplate);
  } catch (error) {
    console.warn(`Failed to parse URI template "${uriTemplate}":`, error);
    return null;
  }
}

/** Any `{…}` expression in the template, with its body captured. */
const ANY_EXPRESSION = /\{([^{}]*)\}/g;

/**
 * Why this template cannot be handled, or `null` if it can.
 *
 * Checked on the template *as the server declared it*, before any rewriting —
 * the multi-name grouping would otherwise mask an empty member by folding
 * `{a,}` into a synthetic single-name expression.
 *
 * Two cases, both of which the SDK accepts and mishandles rather than
 * rejecting:
 *
 * - **An expression declaring no variable.** `new UriTemplate("x://{}")`
 *   parses, reports no variable names, and expands to `x://`. That defeats the
 *   null-on-malformed contract in the most dangerous way: the panel renders no
 *   inputs, so its "every variable is filled" check is vacuously true and it
 *   submits a URI that is not the template the server advertised. `{ }`,
 *   `{,}`, and `{a,}` are the same defect with some members missing.
 * - **The `;` path-parameter operator**, which the SDK does not implement: it
 *   reads `{;a}` as a variable literally named `";a"` and expands it to the
 *   bare value, dropping the required `;a=`. No arrangement of its own branches
 *   produces the right output.
 */
function unsupportedReason(uriTemplate: string): string | null {
  for (const [, body] of uriTemplate.matchAll(ANY_EXPRESSION)) {
    if (body.startsWith(";")) {
      return "the ; (path-parameter) operator is unsupported";
    }
    const names = body.replace(/^[+#./?&]/, "").split(",");
    if (names.some((name) => name.trim().length === 0)) {
      return "an expression declares no variable";
    }
  }
  return null;
}

/**
 * Expand, converting a throw into `null`.
 *
 * Parsing succeeding does not mean expanding will: the SDK also enforces a
 * 1,000,000-character ceiling per *value*, which is checked at expansion time.
 * The inputs have no matching limit, so a paste can reach it — and the preview
 * expands during render, where an escaping throw unmounts the panel instead of
 * showing a problem with the value.
 */
function tryExpand(
  template: UriTemplate,
  values: Record<string, string | string[]>,
): string | null {
  try {
    return template.expand(values);
  } catch (error) {
    console.warn("Failed to expand URI template:", error);
    return null;
  }
}

/**
 * The variable names declared by `uriTemplate`, in declaration order —
 * including those inside non-simple expressions (`{?topic}`, `{+path}`,
 * `{#frag}`, `{/seg*}`, …), which the old regex missed entirely.
 *
 * One boundary is inherited from the SDK rather than chosen here: it does not
 * implement prefix modifiers, so `{topic:3}` yields the name `"topic:3"` and
 * expands without truncating. That behavior is shared with the TUI's form
 * builder and `readResourceFromTemplate`, which parse through the same class.
 */
export function templateVariableNames(uriTemplate: string): string[] {
  if (warnIfUnsupported(uriTemplate)) return [];
  const template = parseTemplate(uriTemplate);
  return template ? uniqueNames(template) : [];
}

/** Warn once with the reason, and report whether the template is unsupported. */
function warnIfUnsupported(uriTemplate: string): boolean {
  const reason = unsupportedReason(uriTemplate);
  if (reason === null) return false;
  console.warn(`Cannot handle URI template "${uriTemplate}": ${reason}.`);
  return true;
}

/**
 * A name repeated across expressions (`x://{a}/{b}/{a}`) is one input, not two —
 * and the preview's sentinel bookkeeping is keyed by position, so a duplicate
 * would otherwise leave one occurrence un-substituted.
 */
function uniqueNames(template: UriTemplate): string[] {
  return [...new Set(template.variableNames)];
}

/**
 * Matches a multi-name expression whose operator is *not* `?` or `&`.
 *
 * The SDK expands this shape through a branch that returns the raw values
 * joined by `,`, skipping both `encodeValue` and the operator prefix — so
 * `x://{a,b}` with `a = "foo/bar"` yields `x://foo/bar,x y` rather than
 * `x://foo%2Fbar,x%20y`, and `{#a,b}` loses its `#` entirely. Its query
 * counterpart (`{?a,b}`) takes a different, correct branch.
 *
 * `groupMultiNameExpressions` rewrites this shape so the SDK's *single*-name
 * branch — which does apply the operator's encoding and separator, over an
 * array value — handles it instead.
 */
const MULTI_NAME_EXPRESSION = /\{([+#./]?)([^{}?&;][^{}]*)\}/g;

/**
 * The name the SDK will parse out of a group member, so `applyGroups` looks up
 * the same key the form stores.
 *
 * It strips a trailing explode modifier (`{a*}` → `a`) but *keeps* a prefix
 * modifier (`{a:3}` → `a:3`, see `templateVariableNames`). Mirroring it exactly
 * is the point: normalizing differently would silently drop a filled value.
 */
function memberName(raw: string): string {
  return raw.trim().replace(/\*$/, "");
}

/**
 * Name for the synthetic variable a rewritten group expands from, chosen so it
 * cannot collide with a variable the template already declares — otherwise a
 * template like `x://{a,b}/{__inspectorGroup0__}` would have the group's value
 * overwrite the user's own, emitting the group twice.
 */
function groupName(prefix: string, index: number): string {
  return `${prefix}${index}__`;
}

const GROUP_PREFIX = "__inspectorGroup";

interface GroupedTemplate {
  /** The rewritten template string, safe to hand to the SDK. */
  text: string;
  /** Synthetic variable name → the real names it stands for, in order. */
  groups: Map<string, string[]>;
}

/**
 * Rewrite each multi-name non-query expression into a single synthetic
 * variable, so the SDK applies the operator's encoding and separator.
 *
 * `x://{a,b}` becomes `x://{__inspectorGroup0__}`, expanded with an *array* of
 * the defined values — which the SDK's single-name branch encodes elementwise
 * and joins with the operator's separator, exactly as RFC 6570 prescribes.
 * Templates without this shape are returned unchanged and pay nothing.
 */
function groupMultiNameExpressions(uriTemplate: string): GroupedTemplate {
  const groups = new Map<string, string[]>();
  // The prefix must not occur in the template, or a template declaring a
  // variable of that name would have the group overwrite the user's value.
  const prefix = padPastCollisions(GROUP_PREFIX, "_", uriTemplate);
  const text = uriTemplate.replace(
    MULTI_NAME_EXPRESSION,
    (match, operator: string, body: string) => {
      if (!body.includes(",")) return match;
      const names = body.split(",").map(memberName);
      const synthetic = groupName(prefix, groups.size);
      groups.set(synthetic, names);
      return `{${operator}${synthetic}}`;
    },
  );
  return { text, groups };
}

/**
 * Project the caller's per-name values onto the synthetic group variables.
 *
 * A group is omitted when none of its names has a value, matching RFC 6570's
 * rule that an expression with no defined variable contributes nothing.
 */
function applyGroups(
  variables: Record<string, string>,
  groups: Map<string, string[]>,
): Record<string, string | string[]> {
  if (groups.size === 0) return variables;
  const projected: Record<string, string | string[]> = { ...variables };
  for (const [synthetic, names] of groups) {
    const present = names
      .filter((name) => variables[name] !== undefined)
      .map((name) => variables[name]);
    // Assign or *delete* — never leave the caller's own value under this key.
    // `projected` starts as a copy of every supplied variable, so a caller that
    // happens to pass a key equal to the generated name would otherwise have it
    // expand the group's expression: `expandTemplate("x://{a,b}",
    // { __inspectorGroup0__: "injected" })` would emit `x://injected` for an
    // expression whose real members are all undefined, where the SDK ignores
    // undeclared variables entirely.
    if (present.length > 0) projected[synthetic] = present;
    else delete projected[synthetic];
  }
  return projected;
}

/** RFC 3986 §2.3 unreserved: the set never percent-encoded, under any operator. */
const UNRESERVED = /[A-Za-z0-9\-._~]/;

/** RFC 3986 §2.2 reserved (gen-delims + sub-delims), allowed by `+` and `#`. */
const RESERVED = /[:/?#[\]@!$&'()*+,;=]/;

/** `encodeURIComponent` leaves these alone; RFC 6570 requires them encoded. */
const UNDER_ENCODED_BY_ENCODE_URI_COMPONENT = /[!'()*]/g;

/**
 * Percent-encode `value` for an expression using `operator`, per RFC 6570 §3.2.1.
 *
 * The SDK's own encoding is not RFC-conformant in three ways, all verified
 * against the pinned version, and all reachable from a plain text input:
 *
 * - simple and query expansions use `encodeURIComponent`, which leaves `!`,
 *   `*`, `'`, `(` and `)` bare — `{v}` with `!` gives `x://!` where the RFC
 *   requires `x://%21`;
 * - `+` and `#` use `encodeURI`, which escapes `[` and `]` — but those are
 *   gen-delims, which reserved expansion is specifically meant to pass through;
 * - `+` and `#` also re-encode an existing pct-triplet, turning `%41` into
 *   `%2541`, where the RFC keeps a well-formed triplet as-is.
 *
 * So this module owns value encoding and leaves *structure* — operators,
 * separators, which expressions appear at all — to the SDK. See
 * `expandWithPlaceholders` for how the two are combined.
 */
function encodeValue(value: string, operator: string): string {
  const allowReserved = operator === "+" || operator === "#";
  let out = "";
  for (let at = 0; at < value.length; ) {
    const char = value[at];
    if (
      allowReserved &&
      char === "%" &&
      /^[0-9A-Fa-f]{2}$/.test(value.slice(at + 1, at + 3))
    ) {
      // A well-formed triplet is already pct-encoded; reserved expansion keeps it.
      out += value.slice(at, at + 3);
      at += 3;
      continue;
    }
    if (UNRESERVED.test(char) || (allowReserved && RESERVED.test(char))) {
      out += char;
      at += 1;
      continue;
    }
    // Encode a whole code point, so a surrogate pair yields its UTF-8 octets
    // rather than two lone-surrogate errors.
    const codePoint = String.fromCodePoint(value.codePointAt(at) as number);
    out += encodeURIComponent(codePoint).replace(
      UNDER_ENCODED_BY_ENCODE_URI_COMPONENT,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    at += codePoint.length;
  }
  return out;
}

/**
 * The SDK's per-value ceiling, enforced here instead of by it.
 *
 * Because a value now reaches the SDK as a short sentinel and is substituted in
 * afterwards, the SDK's own `validateLength` no longer sees it — so without this
 * the helper would happily emit a URI the SDK itself refuses to build. Keeping
 * the same bound preserves that guard, and with it the panel's behavior of
 * withholding the request rather than sending something absurd.
 */
const MAX_VALUE_LENGTH = 1_000_000;

/** Operator declared for each variable name, read off the original template. */
function operatorsByName(uriTemplate: string): Map<string, string> {
  const operators = new Map<string, string>();
  for (const [, body] of uriTemplate.matchAll(ANY_EXPRESSION)) {
    const operator = /^[+#./?&]/.test(body) ? body[0] : "";
    const names = body.slice(operator.length).split(",").map(memberName);
    for (const name of names) {
      if (!operators.has(name)) operators.set(name, operator);
    }
  }
  return operators;
}

/**
 * Expand `uriTemplate`, letting the SDK build the *structure* while this module
 * supplies each variable's *rendering*.
 *
 * Every variable that will appear is handed to the SDK as a sentinel token made
 * only of unreserved characters, so it survives whichever encoding the SDK
 * applies, and is swapped for its real rendering afterwards. That split is what
 * lets the operators, separators, and omission rules stay the SDK's job while
 * the encoding — which the SDK gets wrong (see `encodeValue`) — becomes ours.
 *
 * `renderUnset` decides what an absent-or-empty variable becomes: `null` omits
 * it (the wire behavior), while returning a string substitutes it (the preview's
 * `{name}` placeholder).
 *
 * The substitution is a single regex pass over the expansion, not one pass per
 * variable: the SDK accepts a 1 MB template with up to 10,000 expressions, and a
 * per-variable rescan would be O(variables × length) on the render thread.
 */
function expandWithPlaceholders(
  uriTemplate: string,
  variables: Record<string, string>,
  renderUnset: (name: string) => string | null,
): string | null {
  const { text, groups } = groupMultiNameExpressions(uriTemplate);
  const template = parseTemplate(text);
  if (!template) return null;

  // Map each synthetic group back to the real names it stands for, so both the
  // rendering and the preview's placeholders speak in the form's own names.
  const names = [
    ...new Set(
      uniqueNames(template).flatMap((name) => groups.get(name) ?? [name]),
    ),
  ];
  const operators = operatorsByName(uriTemplate);
  const base = uncollidingBase(uriTemplate);

  const renderings = new Map<number, string>();
  const values: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    const value = variables[name];
    if (value !== undefined && value.length > MAX_VALUE_LENGTH) {
      console.warn(
        `Cannot expand URI template "${uriTemplate}": the value for "${name}" exceeds ${MAX_VALUE_LENGTH} characters.`,
      );
      return null;
    }
    const rendered =
      value === undefined
        ? renderUnset(name)
        : encodeValue(value, operators.get(name) ?? "");
    if (rendered === null) continue; // leave unset, so the expression omits it
    renderings.set(index, rendered);
    values[name] = sentinelFor(base, index);
  }

  const expanded = tryExpand(template, applyGroups(values, groups));
  if (expanded === null) return null;

  return expanded.replace(
    new RegExp(`${base}(\\d+)zz`, "g"),
    /* v8 ignore next -- the `?? match` fallback is unreachable: every sentinel
       in the expansion was minted from `renderings` just above. */
    (match, index: string) => renderings.get(Number(index)) ?? match,
  );
}

/**
 * Expands `uriTemplate` per RFC 6570, percent-encoding each value according to
 * its expression's operator. Returns `null` when the template cannot be handled
 * or a value cannot be expanded, so a caller can decline to issue the request
 * rather than send a URI it knows is wrong.
 *
 * An absent variable is omitted, while one defined as the empty string is kept —
 * preserving the spec's distinction between the two, so `{ topic: "" }` against
 * `{?topic}` yields `?topic=`. Collapsing them would make a deliberately-empty
 * value unexpressible.
 */
export function expandTemplate(
  uriTemplate: string,
  variables: Record<string, string>,
): string | null {
  if (warnIfUnsupported(uriTemplate)) return null;
  return expandWithPlaceholders(uriTemplate, variables, () => null);
}

/**
 * Base of the token used to stand in for a variable the user hasn't filled yet,
 * so the preview can show `{topic}` in its place instead of silently dropping it.
 *
 * Every character is RFC 3986 *unreserved*, so `expand` passes it through
 * verbatim under every operator and it survives to be swapped back out.
 * Percent-encoding can never *produce* this sequence either — it only emits
 * `%` plus hex digits, and the base contains characters outside that set — so
 * checking the raw inputs for a collision (below) is sufficient.
 */
const UNFILLED_SENTINEL = "zzInspectorUnfilledzz";

/**
 * Pick a sentinel base that appears nowhere in the template's literal text.
 *
 * Only the template needs checking: values never reach the expansion — they are
 * substituted in afterwards, in a single pass that does not rescan what it
 * inserts — so a value equal to the token cannot be mistaken for one.
 *
 * Done in one pass rather than by extending the base until it stops colliding:
 * the template is server-supplied and may be up to 1 MB, and a template holding
 * the token followed by a long run of `z`s would make every extended candidate
 * collide in turn, each rescanning the whole input — quadratic work on the
 * render thread. Instead, measure the longest run of `z` that follows any
 * occurrence and clear it by one, which no occurrence can then match.
 */
function uncollidingBase(uriTemplate: string) {
  return padPastCollisions(UNFILLED_SENTINEL, "z", uriTemplate);
}

/**
 * Extend `token` with `pad` characters until it cannot occur in `haystack`.
 *
 * Done by measuring, in a single pass, the longest run of `pad` that follows
 * any occurrence, then clearing it by one. The obvious `while
 * (haystack.includes(candidate)) candidate += pad` is quadratic on exactly the
 * input that motivates the check: a haystack holding the token followed by a
 * long run of `pad` makes every successive candidate collide, each rescanning
 * the whole string — and the template is server-supplied, up to 1 MB, scanned
 * on the render thread.
 *
 * The scan advances one character at a time rather than by the token's length,
 * because a token that begins and ends with the same characters can overlap
 * itself: `zzInspectorUnfilledzzInspectorUnfilledzzz0zz` holds a second
 * occurrence at index 19 whose trailing run is longer than the first's. Skipping
 * it would choose a colliding token after all.
 */
function padPastCollisions(
  token: string,
  pad: string,
  haystack: string,
): string {
  let longestRun = -1;
  for (
    let at = haystack.indexOf(token);
    at !== -1;
    at = haystack.indexOf(token, at + 1)
  ) {
    let run = 0;
    let cursor = at + token.length;
    while (haystack[cursor] === pad) {
      run++;
      cursor++;
    }
    if (run > longestRun) longestRun = run;
  }
  // -1 means the token is absent, so it needs no padding at all.
  return token + pad.repeat(longestRun + 1);
}

/**
 * Keyed by the variable's position rather than its name: a name may legally
 * contain characters (`%`-encoded triplets) that `expand` would re-encode,
 * which would keep the sentinel from surviving the round trip.
 *
 * The trailing delimiter is load-bearing — without it index 1's token would be
 * a prefix of index 11's, and substituting the first would corrupt the second.
 */
function sentinelFor(base: string, index: number): string {
  return `${base}${index}zz`;
}

/**
 * The subset of `variables` the user has actually typed something into.
 *
 * This is a *preview* notion, not an RFC 6570 one — `expandTemplate`
 * deliberately does not collapse `""` this way. The panel seeds every declared
 * variable with `""` and a text input cannot express "defined but empty", so
 * within the preview an empty string means "not entered yet" and earns a
 * `{name}` placeholder rather than an empty expansion.
 */
function enteredValues(
  variables: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(variables).filter(([, value]) => value.length > 0),
  );
}

/**
 * A human-readable rendering of the template with the values entered so far:
 * filled variables are expanded (and encoded) exactly as they would be on the
 * wire, while unfilled ones are shown as `{name}` so the shape of the URI stays
 * legible while the form is still being completed.
 *
 * Falls back to the raw template when it cannot be parsed or expanded — this
 * runs during render, so it must not throw.
 */
export function previewTemplate(
  uriTemplate: string,
  variables: Record<string, string>,
): string {
  // Nothing truthful to render for a template the expander declines, so show it
  // as the server declared it.
  if (unsupportedReason(uriTemplate) !== null) return uriTemplate;
  return (
    expandWithPlaceholders(
      uriTemplate,
      enteredValues(variables),
      (name) => `{${name}}`,
    ) ?? uriTemplate
  );
}
