/**
 * SEP-2792 per-request language preference: mirror
 * `params._meta["io.modelcontextprotocol/acceptLanguage"]` into the upstream
 * `Accept-Language` header (#2979).
 *
 * `_meta` is the canonical carrier on every transport; on Streamable HTTP a
 * client also mirrors it to `Accept-Language`, and a server MAY reject a
 * *present* header that disagrees (`400` / `HeaderMismatch`, `-32020`) while
 * tolerating a *missing* one. Agreement is exact string equality between the
 * decoded `_meta` value and the parsed field value, so this module only ever
 * produces a header that carries the value unchanged — and produces none when
 * it cannot, rather than send a rewritten one.
 *
 * ⚠️ "None" does not reach the server as an absent header: Node's `fetch`
 * (undici) sends `Accept-Language: *` on any request that carries none. So a
 * `_meta` value this module refuses (surrounding whitespace, control or
 * non-ASCII characters — none of which the `Accept-Language` grammar admits)
 * still arrives beside `*` and a strict server will report the mismatch. That
 * is the honest outcome for an unrepresentable value; the case that matters,
 * a well-formed preference, is always mirrored exactly.
 *
 * Why the Inspector derives the header rather than accepting it from the
 * browser: the web client's upstream request is issued by its Node backend,
 * whose per-send header channel is deliberately restricted to SEP-2243
 * `Mcp-Param-*` names (`mcpParamHeadersOnly`) so a page cannot inject arbitrary
 * upstream headers. Deriving `Accept-Language` from the JSON-RPC message itself
 * keeps that allowlist intact: the only value that can reach the header is the
 * one the request already carries in its body, which is what the spec requires
 * it to be anyway.
 */

/** The SEP-2792 request `_meta` key carrying the language preference. */
export const ACCEPT_LANGUAGE_META_KEY =
  "io.modelcontextprotocol/acceptLanguage";

/** The SEP-2792 result `_meta` key reporting the language actually used. */
export const CONTENT_LANGUAGE_META_KEY =
  "io.modelcontextprotocol/contentLanguage";

/** The HTTP header the `_meta` preference is mirrored to. */
export const ACCEPT_LANGUAGE_HEADER = "Accept-Language";

/**
 * A field value HTTP can carry byte-for-byte: visible ASCII with interior
 * spaces or tabs, and no leading or trailing whitespace. The `Accept-Language`
 * grammar is ASCII, and anything outside this shape would either be rejected
 * by `fetch` (control characters, CR/LF) or altered in transit — `Headers`
 * trims surrounding whitespace, so `" en"` would arrive as `"en"` and fail the
 * exact-equality check a strict server applies.
 */
const EXACT_FIELD_VALUE = /^[\x21-\x7e](?:[\x20-\x7e\t]*[\x21-\x7e])?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The language preference a request's `_meta` carries, when it is one that can
 * be mirrored exactly; otherwise `undefined`.
 */
export function acceptLanguageFromMeta(meta: unknown): string | undefined {
  if (!isRecord(meta)) return undefined;
  const value = meta[ACCEPT_LANGUAGE_META_KEY];
  if (typeof value !== "string" || !EXACT_FIELD_VALUE.test(value)) {
    return undefined;
  }
  return value;
}

/**
 * The `Accept-Language` header a JSON-RPC message's POST should carry, derived
 * from its own `params._meta`, or `undefined` when it carries no mirrorable
 * preference. Applies to requests and notifications alike — both are POSTed
 * with `params` — and never to a response, which has no `params`.
 */
export function acceptLanguageHeaderFor(
  message: unknown,
): Record<string, string> | undefined {
  if (!isRecord(message) || !isRecord(message.params)) return undefined;
  const value = acceptLanguageFromMeta(message.params._meta);
  return value === undefined ? undefined : { [ACCEPT_LANGUAGE_HEADER]: value };
}
