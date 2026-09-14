/**
 * The web Resources form's view of an RFC 6570 URI template (#1919).
 *
 * Parsing, variable classification, and expansion live in
 * `@inspector/core/mcp/uriTemplate.js` so the web form and the TUI cannot
 * disagree about what a template means -- they are re-exported here so the
 * panel has a single import. (The CLI is not a consumer: it has no template
 * form, and its `resources/read` passes an already-expanded `--uri` straight to
 * `readResource`.) What this module adds is the one piece that is purely a
 * display concern: the partially-expanded preview string.
 */

import {
  declaredNames,
  definedValues,
  encodeLiteral,
  expandTemplateExpression,
  parseUriTemplate,
  templateError,
  valueLengthError,
} from "@inspector/core/mcp/uriTemplate.js";

export {
  definedValues,
  encodeLiteral,
  expandUriTemplate,
  hasRequiredValues,
  parseUriTemplate,
  requiredGroups,
  templateError,
  templateVariables,
  tryExpandUriTemplate,
  unmetRequiredGroups,
  valueLengthError,
} from "@inspector/core/mcp/uriTemplate.js";
export type {
  TemplateExpansion,
  TemplatePart,
  TemplateVariable,
  VarSpec,
} from "@inspector/core/mcp/uriTemplate.js";

/**
 * A partially-expanded template for display: an expression with at least one
 * value is expanded exactly as the wire would render it, and the rest are left
 * standing as written so the user can see what is still needed.
 *
 * Assembled part by part rather than by rewriting the template and re-parsing
 * it. The rewrite approach needed a placeholder to stand in for each unexpanded
 * expression, and a placeholder is exactly what cannot survive the round trip
 * now that literals are pct-encoded on expansion (RFC 6570 §3.1) -- whatever
 * token stood in for `{?topic}` would come back encoded and no longer match.
 * Going part by part removes the token, and with it the question of what text
 * could never collide with a server-supplied template.
 *
 * Each half still comes from the shared expander -- `encodeLiteral` for literal
 * runs, `expandTemplateExpression` for filled ones -- so the preview cannot
 * promise a URI that submitting would not send.
 *
 * Two guards keep that promise, both of them things the previous
 * expand-the-whole-template implementation got for free from the lenient
 * `expandUriTemplate` it called:
 *
 * - **A template the read would refuse is shown verbatim.** `{a,}` still
 *   parses `a` into its varspecs, and `x://{a}}/{b}` parses two perfectly good
 *   expressions around a stray `}`, so expanding either previewed a URI whose
 *   submission is refused outright. `templateError` is the read's own verdict,
 *   so consulting it first is what keeps the two from disagreeing -- and it
 *   subsumes the narrower "skip the invalid part" rule this had at first,
 *   which left the *rest* of such a template expanding.
 * - **The whole thing is wrapped.** This runs during render, where a throw
 *   unmounts the panel instead of disabling its button, and encoding can throw
 *   for real input: `encodeURIComponent` raises `URIError` on an unpaired
 *   surrogate, which a paste can deliver. The panel already reports that case
 *   through `tryExpandUriTemplate`; here it degrades to the raw template.
 */
export function previewUriTemplate(
  uriTemplate: string,
  values: Record<string, string>,
): string {
  const defined = definedValues(values);

  // The same verdict the read is gated on. Without it this expanded expression
  // by expression regardless: `x://{a}}/{b}` with both fields filled previewed
  // `x://1}/2`, a URI whose stray `}` makes every read refuse -- the preview
  // promising something the form it sits in can never send.
  if (templateError(uriTemplate) !== null) return uriTemplate;

  const parts = parseUriTemplate(uriTemplate);

  // The same ceiling `tryExpandUriTemplate` enforces for the read, scoped the
  // same way -- to the names this template references. Without it the guard was
  // half a guard: submission was refused while this path still handed the
  // oversized value to the encoders on every keystroke, so a large paste froze
  // the UI anyway. Checked before any encoding happens.
  if (valueLengthError(defined, declaredNames(parts)) !== null) {
    return uriTemplate;
  }

  try {
    return parts
      .map((part) => {
        if (part.kind === "literal") return encodeLiteral(part.text);
        // `Object.hasOwn`, not a bare lookup: `toString` and `constructor` are
        // valid RFC 6570 variable names, and a plain lookup would find
        // `Object.prototype`'s member and treat a blank field as filled.
        return part.names.some((name) => Object.hasOwn(defined, name))
          ? expandTemplateExpression(part, defined)
          : part.source;
      })
      .join("");
  } catch {
    return uriTemplate;
  }
}
