/**
 * Formatting helpers for the proxy's diagnostic log lines.
 *
 * Extracted from index.ts so they can be unit-tested independently (index.ts
 * starts the server on import).
 *
 * The header object built for an upstream connection carries the values the
 * user supplied for that server — `Authorization`, and any custom headers
 * named through `x-custom-auth-header(s)` — and the stdio `env` query
 * parameter carries the environment the user configured for a local server.
 * Both are forwarded on purpose, but stdout is a different audience (terminal
 * scrollback, container log drivers, CI capture), so the log lines describe
 * them by NAME only and never print a value.
 */

/**
 * Returns the header names of `headers` as a JSON array, without any values.
 */
export function formatHeaderNamesForLog(
  headers: Record<string, string>,
): string {
  return JSON.stringify(Object.keys(headers));
}

/**
 * Returns a JSON rendering of the request query in which the `env` parameter
 * is reduced to its variable names. An `env` that is not a JSON object is
 * replaced by a fixed placeholder rather than echoed.
 */
export function formatQueryForLog(query: Record<string, unknown>): string {
  if (!("env" in query)) {
    return JSON.stringify(query);
  }
  return JSON.stringify({ ...query, env: describeEnv(query.env) });
}

function describeEnv(env: unknown): string {
  if (typeof env !== "string") {
    return "[omitted]";
  }
  try {
    const parsed: unknown = JSON.parse(env);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return `[names: ${Object.keys(parsed).join(", ")}]`;
    }
  } catch {
    // Fall through to the placeholder: an unparseable value is still not logged.
  }
  return "[omitted]";
}
