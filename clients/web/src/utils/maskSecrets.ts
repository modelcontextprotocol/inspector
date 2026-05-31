/**
 * Masks sensitive OAuth values inside a captured HTTP body for display in the
 * Network tab. OAuth token-exchange / registration responses carry credentials
 * (`access_token`, `refresh_token`, …) and the token *request* (a
 * `application/x-www-form-urlencoded` body) carries `code` / `code_verifier` /
 * `client_secret`. We show the body so it's inspectable, but mask those values
 * by default so they aren't exposed at a glance during a screen-share. The raw
 * body is preserved by the caller and shown only when the user reveals it.
 *
 * Content-type selects the parser: `*json*` → JSON masking, form-urlencoded →
 * form masking, any other known type → no masking. When the content-type is
 * absent/unknown the body is sniffed (parse as JSON first, else treat as
 * form). See `maskSecretsInBody`.
 */

// Keys masked in JSON bodies — bearer-grade secrets only. `code` is
// deliberately NOT here: a JSON body's `code` is usually something else (e.g.
// a JSON-RPC error `code`), and we don't want to mask those.
// `registration_access_token` is the DCR management credential (RFC 7592),
// same bearer class as `access_token`.
const JSON_SENSITIVE_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "registration_access_token",
]);

// Keys masked in form-encoded bodies — the JSON set plus the single-use OAuth
// request material that only appears as form params (authorization code, PKCE
// verifier, private-key-JWT client assertion).
const FORM_SENSITIVE_KEYS = new Set([
  ...JSON_SENSITIVE_KEYS,
  "code",
  "code_verifier",
  "client_assertion",
]);

// What a masked value is replaced with. A fixed-width dotted string keeps the
// shape recognizable as "a value was here" without hinting at its length.
export const MASK_PLACEHOLDER = "••••••••";

function isSensitiveKey(set: ReadonlySet<string>, key: string): boolean {
  return set.has(key.toLowerCase());
}

// Whether a value under a sensitive key should be masked. The contract is
// "any non-null, non-empty-string value": strings are masked when non-empty
// (an empty `access_token` carries nothing), and any non-string value
// (object/array/number/boolean wrapper — pathological for OAuth, but a safe
// default) is masked wholesale so it can't leak through the recursion.
function isMaskableValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  return true;
}

interface MaskedNode {
  node: unknown;
  masked: boolean;
}

// Recursively mask sensitive values in a parsed JSON node, tracking whether
// anything was masked (so the caller never has to infer it by comparing
// serializations — reformatting alone can't trip the flag, and it's robust if
// this function ever grows non-identity transforms).
function maskNode(node: unknown): MaskedNode {
  if (Array.isArray(node)) {
    let masked = false;
    const out = node.map((item) => {
      const r = maskNode(item);
      masked = masked || r.masked;
      return r.node;
    });
    return { node: out, masked };
  }
  if (node !== null && typeof node === "object") {
    let masked = false;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (isSensitiveKey(JSON_SENSITIVE_KEYS, key) && isMaskableValue(value)) {
        out[key] = MASK_PLACEHOLDER;
        masked = true;
      } else {
        const r = maskNode(value);
        out[key] = r.node;
        masked = masked || r.masked;
      }
    }
    return { node: out, masked };
  }
  return { node, masked: false };
}

export interface MaskResult {
  /** The body with sensitive values replaced; pretty-printed for JSON, otherwise the original shape with values substituted. */
  masked: string;
  /** True when at least one sensitive value was masked. */
  hasSecrets: boolean;
}

function maskJsonBody(body: string): MaskResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { masked: body, hasSecrets: false };
  }
  const { node, masked } = maskNode(parsed);
  return { masked: JSON.stringify(node, null, 2), hasSecrets: masked };
}

// Mask sensitive params in a form-urlencoded body, preserving the original
// formatting (we only swap the value, so the placeholder isn't percent-encoded
// the way `URLSearchParams.toString()` would mangle it). A non-form string
// (no `key=value` pairs with a sensitive key) falls through untouched.
function maskFormBody(body: string): MaskResult {
  let hasSecrets = false;
  const masked = body
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      const rawKey = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      let key: string;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        key = rawKey;
      }
      if (isSensitiveKey(FORM_SENSITIVE_KEYS, key) && value.length > 0) {
        hasSecrets = true;
        return `${rawKey}=${MASK_PLACEHOLDER}`;
      }
      return pair;
    })
    .join("&");
  return { masked: hasSecrets ? masked : body, hasSecrets };
}

/**
 * Mask sensitive fields in an HTTP body for display.
 *
 * `contentType` (the body's `content-type` header, if known) picks the parser:
 *   - `*json*`                       → JSON masking (re-serialized pretty)
 *   - `application/x-www-form-urlencoded` → form masking (shape preserved)
 *   - any other known type (HTML, plaintext, XML, …) → no masking
 *   - absent/unknown                 → sniff: parse as JSON, else treat as form
 *
 * Bodies with no sensitive keys return unchanged with `hasSecrets: false` so
 * callers can skip the reveal affordance. The caller keeps the original string
 * for the revealed view.
 *
 * `contentType` is matched by substring (`*json*`, `*x-www-form-urlencoded*`)
 * and we trust the wire's own label — a body mislabeled by the server (e.g.
 * JSON sent as `text/html`) takes the "no masking" branch and renders raw.
 * That's acceptable: the threat model is a screen-share viewer, not an
 * adversary who controls the response's content-type.
 */
export function maskSecretsInBody(
  body: string,
  contentType?: string,
): MaskResult {
  const ct = (contentType ?? "").toLowerCase();
  if (ct) {
    if (ct.includes("json")) return maskJsonBody(body);
    if (ct.includes("x-www-form-urlencoded")) return maskFormBody(body);
    // Known, non-JSON/non-form content type → don't guess; leave it alone.
    return { masked: body, hasSecrets: false };
  }
  // No content-type hint: sniff. Valid JSON → JSON masking; otherwise form.
  try {
    JSON.parse(body);
  } catch {
    return maskFormBody(body);
  }
  return maskJsonBody(body);
}
