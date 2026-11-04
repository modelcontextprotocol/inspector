import type {
  McpUiResourceCsp,
  McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps/app-bridge";

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
 * will actually enforce. The accepted subset is the origin forms
 * {@link SAFE_CSP_SOURCE} matches — `scheme://host[:port][/path]`, a bare or
 * wildcard host, a scheme such as `data:`, and `*`. Anything outside it is
 * dropped (and warned) — including a CSP keyword like `'unsafe-eval'`, which
 * is a perfectly valid source expression in CSP but not something these
 * origin-list fields can express. The resulting object contains only keys with
 * at least one accepted source, and is what the host echoes back to the view
 * via `hostCapabilities.sandbox.csp` so the app sees what was granted, not what
 * it asked for.
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
 *
 * The drop warning is worded accordingly: it names the field the entry came
 * from and states the shape expected, and makes no claim about the *safety* of
 * the value. Saying "unsafe" instead read as a security verdict this check
 * never makes, and sent #2012 chasing an XSS regression that wasn't one, when
 * the entry had merely been the wrong kind of thing for the field (#2064).
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
        console.warn(
          `[mcp-app sandbox] dropping "${key}" entry (expected an origin such ` +
            `as https://example.com or https://*.example.com, a scheme such as ` +
            `data:, or *):`,
          entry,
        );
      }
    }
    if (accepted.length > 0) approved[key] = accepted;
  }
  return approved;
}

/** The permission-key analog of {@link exhaustiveCspKeys}; same compile-time completeness proof. */
function exhaustivePermissionKeys<
  const T extends readonly (keyof McpUiResourcePermissions)[],
>(
  keys: T &
    (keyof McpUiResourcePermissions extends T[number] ? unknown : never),
): T {
  return keys;
}

const PERMISSION_KEYS = exhaustivePermissionKeys([
  "camera",
  "microphone",
  "geolocation",
  "clipboardWrite",
]);

/**
 * Filter an app-supplied permissions bag down to the keys the host will forward
 * to the sandbox proxy, keeping only those the app actually *requested*.
 *
 * The proxy's `buildAllowAttribute()` tests each key for **truthiness**, so an
 * unvalidated bag lets a non-marker stand in for a grant: `{ camera: "false" }`
 * — a plausible way for a server to mean "off" — is truthy and would switch the
 * `allow` attribute on. `_meta` is untrusted input of no declared type, hence
 * the `unknown` parameter: this is the boundary that decides what the shape is,
 * not a consumer of an already-validated one.
 *
 * A key counts as requested only when its value is an **object** — the marker
 * {@link McpUiResourcePermissions} defines for every permission is `{}`, and
 * presence of that object is the request. Everything else fails closed:
 * `true`, `false`, any string, `null`, a number, an array, and any key outside
 * the four the proxy knows. `true` in particular looks like a harmless
 * shorthand, but honoring an undocumented one means a server typo turns an
 * iframe permission ON, which is the wrong direction to guess in.
 *
 * The object is not required to be *empty*. `{}` is a type with no fields yet,
 * not a promise there will never be any — it is precisely the spec's extension
 * point, so rejecting `{ camera: { … } }` would fail closed the day a
 * permission gains an option, silently dropping grants from servers written
 * against the newer spec. The value is normalized to `{}` on the way out
 * either way, so an unrecognized field can't reach the proxy; what it cannot
 * do is *narrow* a grant the key's presence already asked for.
 *
 * Returns undefined when nothing survives, so the notification and the
 * `hostCapabilities.sandbox` echo carry no permissions at all rather than an
 * empty object.
 */
export function approveSandboxPermissions(
  permissions: unknown,
): McpUiResourcePermissions | undefined {
  if (typeof permissions !== "object" || permissions === null) return undefined;
  const bag: Record<string, unknown> = { ...permissions };
  const approved: McpUiResourcePermissions = {};
  let granted = false;
  for (const key of PERMISSION_KEYS) {
    const requested = bag[key];
    if (requested === undefined || requested === false) continue;
    if (
      typeof requested === "object" &&
      requested !== null &&
      !Array.isArray(requested)
    ) {
      approved[key] = {};
      granted = true;
    } else {
      console.warn(
        `[mcp-app sandbox] dropping unrecognized "${key}" permission value:`,
        requested,
      );
    }
  }
  return granted ? approved : undefined;
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
 * The message the wrapper's departure script posts to the sandbox proxy when
 * the wrapped document is being unloaded. The proxy (static/sandbox_proxy.html,
 * which spells the same literal) treats it as the frame leaving the document
 * the host loaded. Not JSON-RPC, and never relayed to the host.
 */
export const SANDBOX_DEPARTURE_MESSAGE = { mcpInspectorSandbox: "departing" };

/**
 * `value` as a JavaScript literal that is safe to splice into an inline
 * `<script>`: `JSON.stringify`, with `<`, `>` and the two line separators
 * escaped so no value can close the element or end the statement early.
 */
export function scriptLiteral(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Posts {@link SANDBOX_DEPARTURE_MESSAGE} to the proxy when the document starts
 * to leave: on `beforeunload`, which a navigation fires even when it aborts the
 * document before its own `load` (where `pagehide` does not fire, and where
 * the proxy's load watch alone cannot tell the next document's `load` from the
 * srcdoc's), and on `pagehide` as well. It runs before any app script, so it
 * captures `parent` (replaceable by the app) and its listeners are registered
 * first, in the capture phase, where no later listener can stop them. The app
 * can still post the message itself, which only closes its own frame.
 */
const DEPARTURE_SCRIPT = `<script>(function(){var p=parent;function f(){p.postMessage(${scriptLiteral(SANDBOX_DEPARTURE_MESSAGE)},"*")}addEventListener("beforeunload",f,true);addEventListener("pagehide",f,true)})()</script>`;

/**
 * Wrap an app's untrusted HTML in a host-authored document whose first
 * `<head>` child is the CSP `<meta>`, followed by the host's departure script
 * ({@link DEPARTURE_SCRIPT}; the policy always allows inline scripts, see
 * {@link buildSandboxCspPolicy}). The wrapper bytes are fixed — the
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
  return `<!DOCTYPE html><html><head>${meta}<meta charset="utf-8">${DEPARTURE_SCRIPT}</head><body>${untrustedHtml}</body></html>`;
}
