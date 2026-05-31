/**
 * Masks sensitive OAuth values inside a captured HTTP body for display in the
 * Network tab. OAuth token-exchange / registration responses carry credentials
 * (`access_token`, `refresh_token`, …) and the token *request* (a
 * `application/x-www-form-urlencoded` body) carries `code` / `code_verifier` /
 * `client_secret`. We show the body so it's inspectable, but mask those values
 * by default so they aren't exposed at a glance during a screen-share. The raw
 * body is preserved by the caller and shown only when the user reveals it.
 *
 * Both JSON and form-encoded bodies are handled; anything else (or a body with
 * no sensitive keys) passes through unchanged with `hasSecrets: false`.
 */

// Keys masked in JSON bodies — bearer-grade secrets only. `code` is
// deliberately NOT here: a JSON body's `code` is usually something else (e.g.
// a JSON-RPC error `code`), and we don't want to mask those.
const JSON_SENSITIVE_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
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

interface MaskedNode {
  node: unknown;
  masked: boolean;
}

// Recursively mask sensitive string values in a parsed JSON node, tracking
// whether anything was masked (so the caller never has to infer it by
// comparing serializations — reformatting alone can't trip the flag, and it's
// robust if this function ever grows non-identity transforms).
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
      if (
        JSON_SENSITIVE_KEYS.has(key.toLowerCase()) &&
        typeof value === "string" &&
        value.length > 0
      ) {
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
      if (FORM_SENSITIVE_KEYS.has(key.toLowerCase()) && value.length > 0) {
        hasSecrets = true;
        return `${rawKey}=${MASK_PLACEHOLDER}`;
      }
      return pair;
    })
    .join("&");
  return { masked: hasSecrets ? masked : body, hasSecrets };
}

export interface MaskResult {
  /** The body with sensitive values replaced; pretty-printed when JSON. */
  masked: string;
  /** True when at least one sensitive value was masked. */
  hasSecrets: boolean;
}

/**
 * Mask sensitive fields in an HTTP body for display. JSON bodies are masked
 * structurally (and re-serialized pretty-printed); non-JSON bodies are treated
 * as form-encoded. Bodies with no sensitive keys return unchanged with
 * `hasSecrets: false` so callers can skip the reveal affordance. The caller
 * keeps the original string for the revealed view.
 */
export function maskSecretsInBody(body: string): MaskResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return maskFormBody(body);
  }
  const { node, masked } = maskNode(parsed);
  return { masked: JSON.stringify(node, null, 2), hasSecrets: masked };
}
