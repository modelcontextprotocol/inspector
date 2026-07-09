import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps/app-bridge";

/**
 * Allowed shapes for a CSP source-expression supplied by an app's
 * `_meta.ui.csp`. Each entry is server-supplied and untrusted: it MUST NOT
 * inject extra directives (`;`) or break out of the meta attribute
 * (`"`, `<`, `>`). Only common source forms are accepted —
 * `scheme://host[:port][/path]`, scheme-only (`data:`, `blob:`), `*`, and
 * wildcard hosts (`*.example.com`, `https://*.example.com`); anything else is
 * dropped by {@link approveCspSources}.
 */
export const SAFE_CSP_SOURCE =
  /^(?:\*|[a-zA-Z][a-zA-Z0-9+.-]*:(?:\/\/(?:\*\.)?[A-Za-z0-9._~%!$&'()*+,=@:-]+(?::\d+)?(?:\/[A-Za-z0-9._~%!$&'()*+,=@:/-]*)?)?|(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)$/;

/**
 * Identity helper that pins `CSP_KEYS` to an exhaustive, valid key list at
 * compile time. `satisfies readonly (keyof McpUiResourceCsp)[]` alone only
 * proves every *listed* key is valid; it does NOT prove the list is *complete*.
 * The intersected conditional adds the missing half: when `CSP_KEYS` covers
 * every key, `keyof McpUiResourceCsp extends T[number]` holds and the parameter
 * type is just `T`; if the upstream ext-apps type ever gains a new domain key,
 * the conditional collapses the parameter type to `never` and the call fails to
 * compile — forcing the key to be added here rather than being silently dropped
 * (a vanished restriction) by {@link approveCspSources}.
 */
function exhaustiveCspKeys<const T extends readonly (keyof McpUiResourceCsp)[]>(
  keys: T & (keyof McpUiResourceCsp extends T[number] ? unknown : never),
): T {
  return keys;
}

const CSP_KEYS = exhaustiveCspKeys([
  "connectDomains",
  "resourceDomains",
  "frameDomains",
  "baseUriDomains",
]);

/**
 * Filter an app-supplied {@link McpUiResourceCsp} down to the entries the host
 * will actually enforce. Unsafe values are dropped (and warned), and the
 * resulting object contains only keys with at least one accepted source. The
 * return value is what the host echoes back to the view via
 * `hostCapabilities.sandbox.csp` so the app sees what was granted, not what it
 * asked for.
 *
 * NOTE: this screens each source for *injection safety* only — it does NOT
 * bound the *breadth* of a grant. A bare `*` (and a scheme-wildcard host) is a
 * syntactically safe source, so `resourceDomains: ["*"]` is "approved" and maps
 * to `script-src 'unsafe-inline' *` (scripts from anywhere), just as
 * `connectDomains: ["*"]` maps to `connect-src *`. That breadth is acceptable
 * here because the enforced document runs in an opaque-origin sandbox with no
 * ambient credentials and nothing to exfiltrate beyond what the app already
 * received; "approved" therefore means "cannot break out of the meta
 * attribute," not "restrictive."
 */
export function approveCspSources(
  csp: McpUiResourceCsp | undefined,
): McpUiResourceCsp {
  const approved: McpUiResourceCsp = {};
  if (!csp) return approved;
  for (const key of CSP_KEYS) {
    const requested = csp[key];
    if (!Array.isArray(requested)) continue;
    const accepted: string[] = [];
    for (const entry of requested) {
      if (typeof entry === "string" && SAFE_CSP_SOURCE.test(entry)) {
        accepted.push(entry);
      } else {
        console.warn("[mcp-app sandbox] dropping unsafe CSP source:", entry);
      }
    }
    if (accepted.length > 0) approved[key] = accepted;
  }
  return approved;
}

function joinSources(list: string[] | undefined, fallback: string): string {
  return list && list.length > 0 ? list.join(" ") : fallback;
}

/**
 * Translate an approved {@link McpUiResourceCsp} into the Content-Security-Policy
 * string enforced on the inner sandboxed document. `default-src 'none'` is the
 * catch-all so any fetch type not explicitly mapped is denied. `script-src` /
 * `style-src` carry `'unsafe-inline'` because the app's own inline code ships
 * with the inline-delivered HTML and has no origin to allowlist; external loads
 * stay restricted to `resourceDomains`.
 *
 * `resourceDomains` intentionally feeds `script-src` (and `style-src`) in
 * addition to `img-src`/`font-src`/`media-src`: the `McpUiResourceCsp` contract
 * defines it as a single "static resources" allowlist that "Maps to CSP
 * `img-src`, `script-src`, `style-src`, `font-src`, `media-src` directives," so
 * an app that lists a CDN there is granted script execution from that origin by
 * design. There is no narrower per-directive key in the contract; if the spec
 * ever splits scripts out, update the mapping here accordingly.
 */
export function buildSandboxCspPolicy(approved: McpUiResourceCsp): string {
  const resourceSrc = joinSources(approved.resourceDomains, "'none'");
  const inlineResource =
    resourceSrc === "'none'"
      ? "'unsafe-inline'"
      : `'unsafe-inline' ${resourceSrc}`;
  return [
    "default-src 'none'",
    `connect-src ${joinSources(approved.connectDomains, "'none'")}`,
    `script-src ${inlineResource}`,
    `style-src ${inlineResource}`,
    `img-src ${resourceSrc}`,
    `font-src ${resourceSrc}`,
    `media-src ${resourceSrc}`,
    `frame-src ${joinSources(approved.frameDomains, "'none'")}`,
    `base-uri ${joinSources(approved.baseUriDomains, "'self'")}`,
    "form-action 'none'",
    "object-src 'none'",
    "worker-src 'none'",
  ].join("; ");
}

/** HTML-attribute-encode a string (defense-in-depth for the CSP meta value). */
export function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Wrap an app's untrusted HTML in a host-authored document whose first
 * `<head>` child is the CSP `<meta>`. The wrapper bytes are fixed — the
 * untrusted content lands inside `<body>` and never precedes the policy, so a
 * `<head>`/`<!-- -->` token in the app's HTML cannot push the meta inert or
 * load resources before the policy applies. If the app's HTML is itself a full
 * document, the second `<!doctype>`/`<html>`/`<head>` are parsed inside
 * `<body>` (the HTML parser ignores duplicate document-structure tags) while
 * its scripts and styles still run — governed by the already-applied policy.
 */
export function wrapSandboxedHtml(
  untrustedHtml: string,
  policy: string,
): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttr(policy)}">`;
  return `<!DOCTYPE html><html><head>${meta}<meta charset="utf-8"></head><body>${untrustedHtml}</body></html>`;
}
