// Patterns matching env-var/header keys whose values may contain secrets.
// When logging, we keep the key (so users can see what was passed) but
// replace the value with `***` so tokens don't end up in stdout/log files.
export const SENSITIVE_KEY_PATTERNS: RegExp[] = [
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /credential/i,
  /api[-_]?key/i,
  /(^|_)key($|_)/i,
  /auth/i,
  /session/i,
  /private/i,
  /^aws_/i,
];

export const REDACTED = "***";

export const isSensitiveKey = (key: string): boolean =>
  SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));

export const redactSensitiveEntries = (
  obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> => {
  if (!obj) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = isSensitiveKey(k) ? REDACTED : v;
  }
  return out;
};

// Returns a copy of an Express query object with the `env` JSON value
// re-serialized with sensitive entries redacted, suitable for logging.
export const redactQueryForLogging = (q: unknown): unknown => {
  if (!q || typeof q !== "object") return q;
  const out: Record<string, unknown> = { ...(q as Record<string, unknown>) };
  if (typeof out.env === "string") {
    try {
      const parsed = JSON.parse(out.env);
      out.env = redactSensitiveEntries(parsed);
    } catch {
      out.env = REDACTED;
    }
  }
  return out;
};
