/**
 * Masks sensitive OAuth values inside a captured HTTP body for display in the
 * Network tab. OAuth token-exchange and registration responses carry
 * credentials (`access_token`, `refresh_token`, …); we show the body so it's
 * inspectable, but mask those values by default so they aren't exposed at a
 * glance during a screen-share. The raw body is preserved by the caller and
 * shown only when the user explicitly reveals it.
 */

// JSON keys whose values are bearer-grade secrets. Matched case-insensitively.
// `client_secret` covers DCR responses for confidential clients; the token
// fields cover the `/token` exchange and refresh responses.
const SENSITIVE_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
]);

// What a masked value is replaced with. A fixed-width dotted string keeps the
// shape recognizable as "a value was here" without hinting at its length.
export const MASK_PLACEHOLDER = "••••••••";

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function maskValue(key: string, value: unknown): unknown {
  if (isSensitiveKey(key) && typeof value === "string" && value.length > 0) {
    return MASK_PLACEHOLDER;
  }
  return maskNode(value);
}

function maskNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => maskNode(item));
  }
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      out[key] = maskValue(key, value);
    }
    return out;
  }
  return node;
}

export interface MaskResult {
  /** The body with sensitive values replaced; pretty-printed when JSON. */
  masked: string;
  /** True when at least one sensitive value was masked. */
  hasSecrets: boolean;
}

/**
 * Mask sensitive fields in a JSON body. Non-JSON bodies (or JSON without any
 * sensitive keys) are returned unchanged with `hasSecrets: false`, so callers
 * can skip the reveal affordance entirely. The masked JSON is re-serialized
 * pretty-printed; the caller keeps the original string for the revealed view.
 */
export function maskSecretsInBody(body: string): MaskResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { masked: body, hasSecrets: false };
  }
  const maskedNode = maskNode(parsed);
  const masked = JSON.stringify(maskedNode, null, 2);
  // The serialized output differs from the input only when something was
  // masked (whitespace-only reformatting aside), but compare the structures
  // directly so reformatting alone never trips the "has secrets" flag.
  const hasSecrets = JSON.stringify(maskedNode) !== JSON.stringify(parsed);
  return { masked, hasSecrets };
}
