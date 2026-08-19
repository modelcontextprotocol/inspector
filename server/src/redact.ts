// Helpers for logging connection parameters without disclosing credentials.
//
// Both the forwarded request headers and the caller-supplied `env` map are
// redacted *by default* rather than by matching secret-looking names. Name
// heuristics do not work for either surface:
//
//   - Header names are caller-chosen. `getHttpHeaders` forwards whatever name
//     arrives in `x-custom-auth-header(s)`, so the credential can land under
//     `X-Foo`, or under a name that a heuristic would consider safe.
//   - Env-var names are arbitrary, and plenty of ordinary ones carry secrets
//     inside their value: `DATABASE_URL=postgres://user:password@host/db`,
//     `AZURE_STORAGE_CONNECTION_STRING=...`.
//
// Keys are preserved, so the log still answers the question it exists to
// answer -- which headers and which env vars are being passed through -- while
// asserting nothing about any value.

export const REDACTED = "***";

const redactAllValues = (
  obj: Record<string, unknown>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of Object.keys(obj)) {
    out[key] = REDACTED;
  }
  return out;
};

// Redacts forwarded request headers for logging: every value is replaced,
// names are kept.
export const redactHeadersForLogging = (
  headers: Record<string, string>,
): Record<string, string> => redactAllValues(headers);

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

  // Only a plain object has env-var names worth showing. An array or a scalar
  // has none, so there is nothing to preserve and it is redacted whole.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return REDACTED;
  }

  return redactAllValues(parsed as Record<string, unknown>);
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
