/**
 * RFC 6570 URI Template helpers for the Resources screen.
 *
 * The web client used to discover variables with `/\{(\w+)\}/g` and expand them
 * with a plain `String.replace`. That only ever saw simple expressions — a
 * query expression like `{?topic}` produced no input at all — and it inserted
 * values verbatim, so a `topic` of `foo/bar` silently became a second path
 * segment instead of `foo%2Fbar` (#1919).
 *
 * These wrap the SDK's `UriTemplate`, which is the same RFC 6570 implementation
 * the TUI's form builder and `InspectorClient.readResourceFromTemplate` already
 * use, so all three surfaces agree on what a template's variables are and on
 * how a value is encoded.
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

/**
 * The variable names declared by `uriTemplate`, in declaration order —
 * including those inside non-simple expressions (`{?topic}`, `{+path}`,
 * `{#frag}`, `{/seg*}`, …), which the old regex missed entirely.
 */
export function templateVariableNames(uriTemplate: string): string[] {
  const template = parseTemplate(uriTemplate);
  return template ? uniqueNames(template) : [];
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
 * Expands `uriTemplate` per RFC 6570, percent-encoding each value according to
 * its expression's operator. Variables with no value are omitted, which is what
 * the spec prescribes and what keeps `{?topic}` from expanding to a dangling
 * `?topic=`.
 */
export function expandTemplate(
  uriTemplate: string,
  variables: Record<string, string>,
): string {
  const template = parseTemplate(uriTemplate);
  if (!template) return uriTemplate;
  return template.expand(withoutEmptyValues(variables));
}

/**
 * A token used to stand in for a variable the user hasn't filled yet, so the
 * preview can show `{topic}` in its place instead of silently dropping it.
 *
 * Every character is RFC 3986 *unreserved*, so `expand` passes it through
 * verbatim under every operator and it survives to be swapped back out.
 */
const UNFILLED_SENTINEL = "zzInspectorUnfilledzz";

/**
 * Keyed by the variable's position rather than its name: a name may legally
 * contain characters (`%`-encoded triplets) that `expand` would re-encode,
 * which would keep the sentinel from surviving the round trip.
 *
 * The trailing delimiter is load-bearing — without it index 1's token would be
 * a prefix of index 11's, and substituting the first would corrupt the second.
 */
function sentinelFor(index: number): string {
  return `${UNFILLED_SENTINEL}${index}zz`;
}

function withoutEmptyValues(
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
 */
export function previewTemplate(
  uriTemplate: string,
  variables: Record<string, string>,
): string {
  const template = parseTemplate(uriTemplate);
  if (!template) return uriTemplate;

  const names = uniqueNames(template);
  const filled = withoutEmptyValues(variables);
  const values: Record<string, string> = { ...filled };
  names.forEach((name, index) => {
    if (values[name] === undefined) values[name] = sentinelFor(index);
  });

  let preview = template.expand(values);
  names.forEach((name, index) => {
    if (filled[name] !== undefined) return;
    // The sentinel is unreserved, so it appears in the expansion unencoded.
    preview = preview.split(sentinelFor(index)).join(`{${name}}`);
  });
  return preview;
}
