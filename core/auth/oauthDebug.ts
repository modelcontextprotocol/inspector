/**
 * `--oauth-debug` (#2844): a step-by-step trace of the OAuth work a terminal
 * client runs, written as plain lines to a sink the caller owns (stderr in the
 * one-shot CLI and mcpdo).
 *
 * Why a fetch wrapper rather than the `OAuthStep` state machine: the shared
 * `oauthStep` field is recorded at only two points today (authorization in
 * progress, and complete), so a trace driven by it would print two lines. The
 * questions someone diagnosing a misconfigured authorization server actually
 * asks — which metadata URL was tried, what it answered, what the
 * registration and token endpoints said — are all answered on the wire, and
 * every one of those requests already crosses the OAuth base fetch
 * (`InspectorClientEnvironment.oauthFetch`, #2749). Wrapping that one fetch
 * therefore sees the SDK's discovery, DCR, code exchange and refresh with no
 * change to the SDK or to `OAuthManager`, and the step name is read off the
 * request itself ({@link classifyOAuthRequest}).
 *
 * Redaction is by field name, never by value shape: every credential the OAuth
 * wire carries — tokens, codes, verifiers, client secrets, assertions — travels
 * under a fixed, spec-defined key, so {@link SENSITIVE_FIELDS} is the whole
 * list. A value under one of those keys is replaced with `[redacted]` in query
 * strings, form bodies and JSON bodies alike, and an `Authorization` header is
 * reduced to its scheme. Anything not on the list is printed, which is the
 * point: client ids, redirect URIs, scopes, endpoints and error descriptions
 * are what a trace is for.
 *
 * Isomorphic — it only reads `Request`/`Response` objects — so it could sit
 * under the browser's OAuth fetch too, though only the Node clients use it.
 */

import { requestHeadersOf, requestUrlOf } from "./requestTimeout.js";

/** Where trace lines go. Each call is one complete line, newline included. */
export type OAuthDebugWrite = (line: string) => void;

/** The prefix every trace line carries, so it greps out of mixed stderr. */
export const OAUTH_DEBUG_PREFIX = "[oauth]";

/** What replaces a redacted value. */
export const REDACTED = "[redacted]";

/**
 * Keys whose values are credentials, across RFC 6749 (token + authorization
 * responses and requests), RFC 7636 (PKCE), RFC 7591/7592 (DCR), RFC 7521/7523
 * (assertions), RFC 8693 (token exchange) and RFC 7009 (revocation).
 */
export const SENSITIVE_FIELDS: ReadonlySet<string> = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "code",
  "code_verifier",
  "client_secret",
  "registration_access_token",
  "assertion",
  "client_assertion",
  "subject_token",
  "actor_token",
  "token",
  "password",
]);

/**
 * Metadata documents are long; these are the fields that answer "where does
 * this flow go next". The rest of the document is left out of the trace.
 */
const PROTECTED_RESOURCE_FIELDS = [
  "resource",
  "authorization_servers",
  "scopes_supported",
] as const;
const AUTHORIZATION_SERVER_FIELDS = [
  "issuer",
  "authorization_endpoint",
  "token_endpoint",
  "registration_endpoint",
  "revocation_endpoint",
  "scopes_supported",
  "code_challenge_methods_supported",
  "token_endpoint_auth_methods_supported",
  "client_id_metadata_document_supported",
] as const;

/** The OAuth step a request belongs to, as named in the trace. */
export type OAuthDebugStep =
  | "protected-resource metadata"
  | "authorization-server metadata"
  | "client registration"
  | "token request"
  | "token revocation"
  | "request";

/** A request body in whichever form it can be read synchronously. */
function bodyParams(body: unknown): URLSearchParams | undefined {
  if (body instanceof URLSearchParams) return body;
  if (typeof body !== "string") return undefined;
  // A JSON body is not a form body; `new URLSearchParams("{...}")` would
  // happily parse it into one nonsense key.
  if (body.trimStart().startsWith("{")) return undefined;
  return new URLSearchParams(body);
}

/** A request body parsed as a JSON object, when it is one. */
function bodyJson(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Name the OAuth step a request belongs to, from its URL and body alone.
 *
 * Well-known paths settle discovery (RFC 9728 and RFC 8414, plus the OIDC
 * path the SDK also probes). A POST is classified by what it carries: a
 * `grant_type` is a token request (code exchange, refresh, client
 * credentials, token exchange), a `token` is RFC 7009 revocation, and a JSON
 * object carrying `redirect_uris` or `client_name` is RFC 7591 registration.
 */
export function classifyOAuthRequest(
  url: string,
  method: string,
  body: unknown,
): OAuthDebugStep {
  let pathname = "";
  try {
    pathname = new URL(url).pathname;
  } catch {
    // An unparseable URL still gets traced; it just cannot be a well-known one.
  }
  if (pathname.includes("/.well-known/oauth-protected-resource")) {
    return "protected-resource metadata";
  }
  if (
    pathname.includes("/.well-known/oauth-authorization-server") ||
    pathname.includes("/.well-known/openid-configuration")
  ) {
    return "authorization-server metadata";
  }
  if (method === "POST") {
    const params = bodyParams(body);
    if (params?.has("grant_type")) return "token request";
    if (params?.has("token")) return "token revocation";
    const json = bodyJson(body);
    if (json && ("redirect_uris" in json || "client_name" in json)) {
      return "client registration";
    }
  }
  return "request";
}

/** `url` with every sensitive query parameter's value redacted. */
export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  let changed = false;
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_FIELDS.has(key)) {
      parsed.searchParams.set(key, REDACTED);
      changed = true;
    }
  }
  return changed ? parsed.href : url;
}

/** A form body rendered as `key=value` pairs, sensitive values redacted. */
export function redactFormParams(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([key, value]) =>
      SENSITIVE_FIELDS.has(key) ? `${key}=${REDACTED}` : `${key}=${value}`,
    )
    .join(" ");
}

/**
 * A copy of `value` with every sensitive key's value replaced, at any depth.
 * Arrays and nested objects are walked; primitives are returned as they are.
 */
export function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SENSITIVE_FIELDS.has(key) ? REDACTED : redactJson(inner);
  }
  return out;
}

function pick(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/** The summary of a request body that goes on the trace's request line. */
function describeRequestBody(step: OAuthDebugStep, body: unknown): string {
  const params = bodyParams(body);
  if (params && [...params.keys()].length > 0) {
    return redactFormParams(params);
  }
  const json = bodyJson(body);
  if (json && step !== "request") return JSON.stringify(redactJson(json));
  return "";
}

/**
 * The summary of a JSON response body: the routing fields of a metadata
 * document, the OAuth error of a failed response, or — for registration and
 * token responses — the whole body, redacted.
 */
export function describeResponseJson(
  step: OAuthDebugStep,
  status: number,
  json: unknown,
): string {
  if (!isRecord(json)) return "";
  if (status >= 400) {
    const error = pick(json, ["error", "error_description", "error_uri"]);
    return Object.keys(error).length > 0 ? JSON.stringify(error) : "";
  }
  if (step === "protected-resource metadata") {
    return JSON.stringify(pick(json, PROTECTED_RESOURCE_FIELDS));
  }
  if (step === "authorization-server metadata") {
    return JSON.stringify(pick(json, AUTHORIZATION_SERVER_FIELDS));
  }
  if (step === "client registration" || step === "token request") {
    return JSON.stringify(redactJson(json));
  }
  return "";
}

/** Read a response's JSON without consuming the body the caller will read. */
async function readJsonClone(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("json")) return undefined;
  try {
    return JSON.parse(await response.clone().text());
  } catch {
    return undefined;
  }
}

function line(text: string): string {
  return `${OAUTH_DEBUG_PREFIX} ${text}\n`;
}

/**
 * Wrap `fetchFn` so every request it makes is written to `write`: one line
 * naming the step, method and (redacted) URL with a summary of the body, then
 * one line with the response status and a summary of what it said — or the
 * error the request failed with, which is rethrown unchanged.
 *
 * The response body is read from a clone, so the caller still receives an
 * unread response.
 */
export function withOAuthDebugTrace(
  fetchFn: typeof fetch,
  write: OAuthDebugWrite,
): typeof fetch {
  return async (input, init) => {
    const url = requestUrlOf(input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const body = init?.body;
    const step = classifyOAuthRequest(url, method, body);
    const authorization = requestHeadersOf(input, init).get("authorization");
    const details = [
      describeRequestBody(step, body),
      authorization
        ? `(Authorization: ${authorization.split(" ")[0]} ${REDACTED})`
        : "",
    ].filter((part) => part !== "");
    write(
      line(
        `${step}: ${method} ${redactUrl(url)}${details.length > 0 ? ` ${details.join(" ")}` : ""}`,
      ),
    );
    let response: Response;
    try {
      response = await fetchFn(input, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      write(line(`  -> failed: ${message}`));
      throw error;
    }
    const summary = describeResponseJson(
      step,
      response.status,
      await readJsonClone(response),
    );
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    write(
      line(
        `  -> ${String(response.status)}${statusText}${summary ? ` ${summary}` : ""}`,
      ),
    );
    return response;
  };
}

/**
 * The trace line for the authorization request the user is sent to. The
 * authorization URL carries no credential (the code comes back on the
 * redirect), so it is printed whole apart from the generic query redaction.
 */
export function describeAuthorizationUrl(url: URL): string {
  return line(`authorization: open ${redactUrl(url.href)}`);
}
