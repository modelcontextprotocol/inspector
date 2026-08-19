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

// Header names that are never credentials: `Accept` is set by the proxy itself
// and `Last-Event-ID` is an SSE resumption cursor defined by the spec, not a
// secret. Every other forwarded header is redacted -- see
// redactHeadersForLogging for why sensitivity cannot be inferred by name there.
const NON_SENSITIVE_HEADERS = new Set(["accept", "last-event-id"]);

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

// Redacts forwarded request headers for logging. Sensitivity cannot be inferred
// from a header's name here: `x-custom-auth-header(s)` lets a caller nominate an
// arbitrarily-named header (`X-Foo`, `X-Access-Key`) to carry its credential, so
// anything not on the known-safe list has its value replaced. Names are kept so
// the log still shows which headers are being forwarded.
export const redactHeadersForLogging = (
  headers: Record<string, string>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = NON_SENSITIVE_HEADERS.has(k.toLowerCase()) ? v : REDACTED;
  }
  return out;
};

// A real `env` payload is a flat string-to-string map. Anything else -- an
// array, a nested object, non-string values -- cannot be redacted key-by-key by
// the shallow redactor, so it is replaced wholesale rather than logged verbatim.
const isFlatStringMap = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every(
    (entry) => typeof entry === "string",
  );

const redactEnvForLogging = (env: unknown): unknown => {
  // Express query values are not necessarily strings: `?env=a&env=b` yields an
  // array and `?env[x]=y` yields an object. Neither is a valid env payload, and
  // this log runs before transport validation, so redact them entirely.
  if (typeof env !== "string") return REDACTED;

  let parsed: unknown;
  try {
    parsed = JSON.parse(env);
  } catch {
    return REDACTED;
  }

  if (!isFlatStringMap(parsed)) return REDACTED;
  return redactSensitiveEntries(parsed);
};

// Returns a copy of an Express query object with the `env` value replaced by a
// redacted form, suitable for logging.
export const redactQueryForLogging = (q: unknown): unknown => {
  if (!q || typeof q !== "object") return q;
  const out: Record<string, unknown> = { ...(q as Record<string, unknown>) };
  if (out.env !== undefined) {
    out.env = redactEnvForLogging(out.env);
  }
  return out;
};
