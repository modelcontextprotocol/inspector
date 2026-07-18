import { ProtocolErrorCode } from "@modelcontextprotocol/client";
import type { FetchRequestEntry } from "@inspector/core/mcp/types.js";

/**
 * SEP-2243 / modern Streamable HTTP transport awareness for the Network tab.
 *
 * The modern (≥2026-07-28) transport mirrors key JSON-RPC body fields into HTTP
 * headers so intermediaries can route/police MCP traffic without parsing bodies
 * (`Mcp-Method`, `Mcp-Name`, `Mcp-Param-*`, `MCP-Protocol-Version`), and defines
 * a small family of spec error codes returned as JSON-RPC bodies over specific
 * HTTP statuses. This module is the pure logic the Network UI uses to recognise,
 * decode, and validate those — no rendering, fully unit-testable.
 *
 * Recorded header keys are lowercased (the fetch tracker reads them through the
 * `Headers` API, which normalises names), so every comparison here is
 * case-insensitive on the name.
 */

/**
 * `-32020 HeaderMismatch` (SEP-2243). The client SDK keeps this in an internal
 * chunk that isn't re-exported from its public barrel, so the spec-reserved
 * value is pinned locally. The other three codes come from the SDK's
 * {@link ProtocolErrorCode} enum.
 */
export const HEADER_MISMATCH_ERROR_CODE = -32020;

const BASE64_SENTINEL_PREFIX = "=?base64?";
const BASE64_SENTINEL_SUFFIX = "?=";

const MCP_STANDARD_HEADER_NAMES: ReadonlySet<string> = new Set([
  "mcp-method",
  "mcp-name",
  "mcp-protocol-version",
]);

const MCP_PARAM_HEADER_PREFIX = "mcp-param-";

/** JSON-RPC `_meta` key carrying the negotiated protocol version. */
export const PROTOCOL_VERSION_META_KEY =
  "io.modelcontextprotocol/protocolVersion";

/** Whether `name` is one of the standard mirrored headers (case-insensitive). */
export function isMcpStandardHeader(name: string): boolean {
  return MCP_STANDARD_HEADER_NAMES.has(name.toLowerCase());
}

/** Whether `name` is an opt-in `Mcp-Param-*` custom header (case-insensitive). */
export function isMcpParamHeader(name: string): boolean {
  return name.toLowerCase().startsWith(MCP_PARAM_HEADER_PREFIX);
}

/** Whether `name` is any modern MCP mirrored header (standard or `Mcp-Param-*`). */
export function isMcpHeader(name: string): boolean {
  return isMcpStandardHeader(name) || isMcpParamHeader(name);
}

export interface DecodedMcpParamValue {
  /** The value shown to the user: decoded when sentinel-encoded, else the raw. */
  value: string;
  /** True when the raw header used the `=?base64?{b64}?=` sentinel form. */
  encoded: boolean;
  /** The original, undecoded header value. */
  raw: string;
}

/**
 * Decode a mirrored header value per SEP-2243's value-encoding rules. A value
 * wrapped as `=?base64?{base64-of-utf8}?=` is decoded to its UTF-8 string;
 * anything else is passed through unchanged. A sentinel wrapper whose inner
 * payload is not valid Base64 is reported as `encoded: true` but left as the raw
 * string (best-effort — never throws).
 */
export function decodeMcpParamValue(raw: string): DecodedMcpParamValue {
  const isSentinel =
    raw.length >=
      BASE64_SENTINEL_PREFIX.length + BASE64_SENTINEL_SUFFIX.length &&
    raw.startsWith(BASE64_SENTINEL_PREFIX) &&
    raw.endsWith(BASE64_SENTINEL_SUFFIX);
  if (!isSentinel) return { value: raw, encoded: false, raw };

  const b64 = raw.slice(
    BASE64_SENTINEL_PREFIX.length,
    raw.length - BASE64_SENTINEL_SUFFIX.length,
  );
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return { value: new TextDecoder().decode(bytes), encoded: true, raw };
  } catch {
    return { value: raw, encoded: true, raw };
  }
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Extract the first JSON-RPC `error` object from a (possibly batched) response
 * body. Returns `null` for an empty, non-JSON, or error-free body. Best-effort
 * and never throws.
 */
export function parseJsonRpcError(
  body: string | undefined,
): JsonRpcError | null {
  if (!body) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== "object") continue;
    if (!("error" in candidate)) continue;
    const err = (candidate as { error: unknown }).error;
    if (err === null || typeof err !== "object") continue;
    const { code, message, data } = err as {
      code?: unknown;
      message?: unknown;
      data?: unknown;
    };
    if (typeof code !== "number") continue;
    return {
      code,
      message: typeof message === "string" ? message : "",
      data,
    };
  }
  return null;
}

export interface McpSpecError {
  code: number;
  /** Spec name, e.g. `HeaderMismatch`. */
  name: string;
  /** One-line explanation for the Network UI. */
  description: string;
  /** HTTP status the spec pairs this code with. */
  expectedHttpStatus: number;
  /** The actual HTTP status recorded on the entry, when present. */
  actualHttpStatus?: number;
  /**
   * For `-32022 UnsupportedProtocolVersion`: the versions the server advertises
   * as supported (from `error.data.supported`), when present.
   */
  supported?: string[];
  /**
   * Whether a "view in Network" link is worth offering on the Protocol alert.
   * True when the error is EITHER thrown by the SDK (its real HTTP response
   * lives only in the Network log — the Protocol entry is a synthetic fold from
   * the correlated fetch) OR tied to the HTTP request/response headers. A
   * delivered, protocol-only error (a missing capability, an unsupported version
   * whose `supported` list is already in the alert) sets this false: the raw
   * HTTP entry adds nothing.
   */
  httpRelevant: boolean;
}

const SPEC_ERROR_META: Record<
  number,
  {
    name: string;
    description: string;
    expectedHttpStatus: number;
    httpRelevant: boolean;
  }
> = {
  [HEADER_MISMATCH_ERROR_CODE]: {
    name: "HeaderMismatch",
    description:
      "An Mcp-* header did not match the JSON-RPC body (SEP-2243). The server rejected the request pre-dispatch.",
    expectedHttpStatus: 400,
    // The mirrored headers are the whole story — the Network entry shows them.
    httpRelevant: true,
  },
  [ProtocolErrorCode.MissingRequiredClientCapability]: {
    name: "MissingRequiredClientCapability",
    description:
      "The server requires a client capability that was not declared (SEP-2575).",
    expectedHttpStatus: 400,
    // Protocol-only: the capability requirement is in the error, not the HTTP.
    httpRelevant: false,
  },
  [ProtocolErrorCode.UnsupportedProtocolVersion]: {
    name: "UnsupportedProtocolVersion",
    description:
      "The requested protocol version is not supported (SEP-2575). The error body lists the supported versions.",
    expectedHttpStatus: 400,
    // Protocol-only: the supported-versions list is already shown in the alert.
    httpRelevant: false,
  },
  [ProtocolErrorCode.MethodNotFound]: {
    name: "MethodNotFound",
    description:
      "Unknown method. A JSON-RPC error body on an HTTP 404 marks a modern server — a legacy HTTP+SSE server returns a bare 404 with no body.",
    expectedHttpStatus: 404,
    // Thrown by the SDK (HTTP 404, not delivered as a frame) — the real
    // response lives only in the Network log, so the link is essential.
    httpRelevant: true,
  },
};

function extractSupportedVersions(data: unknown): string[] | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const supported = (data as { supported?: unknown }).supported;
  if (!Array.isArray(supported)) return undefined;
  const strings = supported.filter((v): v is string => typeof v === "string");
  return strings.length > 0 ? strings : undefined;
}

/**
 * Classify a Network entry's response as one of the modern spec errors, or
 * `null` if it isn't one. `-32601 MethodNotFound` is only treated as the modern
 * marker when it arrives on an HTTP 404 (an in-band `-32601` on a 200 response
 * is an ordinary result, not the transport-level taxonomy this surfaces).
 */
export function classifyMcpSpecError(
  entry: Pick<FetchRequestEntry, "responseBody" | "responseStatus">,
): McpSpecError | null {
  const err = parseJsonRpcError(entry.responseBody);
  if (!err) return null;
  const meta = SPEC_ERROR_META[err.code];
  if (!meta) return null;
  if (
    err.code === ProtocolErrorCode.MethodNotFound &&
    entry.responseStatus !== 404
  ) {
    return null;
  }
  const result: McpSpecError = {
    code: err.code,
    ...meta,
    actualHttpStatus: entry.responseStatus,
  };
  if (err.code === ProtocolErrorCode.UnsupportedProtocolVersion) {
    const supported = extractSupportedVersions(err.data);
    if (supported) result.supported = supported;
  }
  return result;
}

/**
 * Classify a JSON-RPC error *code* (e.g. from a Protocol message's
 * `response.error`) as one of the modern spec errors, or `null`. Unlike
 * {@link classifyMcpSpecError}, this works from the code alone — the Protocol
 * view carries no HTTP status (that lives on the correlated Network entry), so
 * `-32601` is recognised here whenever it appears as a JSON-RPC error, not only
 * on an HTTP 404.
 */
export function classifyProtocolSpecError(
  code: number,
  data?: unknown,
): McpSpecError | null {
  const meta = SPEC_ERROR_META[code];
  if (!meta) return null;
  const result: McpSpecError = { code, ...meta };
  if (code === ProtocolErrorCode.UnsupportedProtocolVersion) {
    const supported = extractSupportedVersions(data);
    if (supported) result.supported = supported;
  }
  return result;
}

/**
 * A bare HTTP 404 with no JSON-RPC body is how a legacy HTTP+SSE endpoint (or a
 * non-MCP server) answers an unknown route — distinct from a modern server's
 * `-32601` 404 (see {@link classifyMcpSpecError}). Surfacing it helps explain
 * why a connection fell back to the legacy transport.
 */
export function isLegacyBare404(
  entry: Pick<FetchRequestEntry, "responseBody" | "responseStatus">,
): boolean {
  return (
    entry.responseStatus === 404 &&
    parseJsonRpcError(entry.responseBody) === null
  );
}

export interface HeaderConsistency {
  /** Canonical lowercase header name. */
  header: string;
  /** The value derived from the JSON-RPC body that the header should mirror. */
  expected: string;
  /** The header's value (sentinel-decoded), as actually sent. */
  actual: string;
  /** Whether the header and body agree. */
  ok: boolean;
}

interface JsonRpcRequestBody {
  method?: unknown;
  params?: {
    name?: unknown;
    uri?: unknown;
    _meta?: Record<string, unknown>;
  };
}

function parseRequestBody(body: string | undefined): JsonRpcRequestBody | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as JsonRpcRequestBody;
  } catch {
    return null;
  }
}

function findHeaderValue(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

/**
 * Cross-check the mirrored standard headers against the request body they
 * derive from, so a `HeaderMismatch` is visible at a glance before the server
 * even rejects it. A row is produced only when BOTH the header is present AND
 * the corresponding body field can be derived — an unverifiable pair (e.g. a
 * connection-level `mcp-protocol-version` on a body with no version envelope) is
 * skipped rather than falsely flagged.
 *
 * Checks: `mcp-method` ↔ body `method`; `mcp-name` (decoded) ↔ body
 * `params.name` / `params.uri`; `mcp-protocol-version` ↔ body
 * `params._meta["io.modelcontextprotocol/protocolVersion"]`.
 */
export function checkHeaderConsistency(
  entry: Pick<FetchRequestEntry, "requestHeaders" | "requestBody">,
): HeaderConsistency[] {
  const body = parseRequestBody(entry.requestBody);
  if (!body) return [];
  const rows: HeaderConsistency[] = [];

  const methodHeader = findHeaderValue(entry.requestHeaders, "mcp-method");
  if (methodHeader !== undefined && typeof body.method === "string") {
    rows.push({
      header: "mcp-method",
      expected: body.method,
      actual: methodHeader,
      ok: methodHeader === body.method,
    });
  }

  const nameHeader = findHeaderValue(entry.requestHeaders, "mcp-name");
  const bodyName =
    typeof body.params?.name === "string"
      ? body.params.name
      : typeof body.params?.uri === "string"
        ? body.params.uri
        : undefined;
  if (nameHeader !== undefined && bodyName !== undefined) {
    const decoded = decodeMcpParamValue(nameHeader).value;
    rows.push({
      header: "mcp-name",
      expected: bodyName,
      actual: decoded,
      ok: decoded === bodyName,
    });
  }

  const versionHeader = findHeaderValue(
    entry.requestHeaders,
    "mcp-protocol-version",
  );
  const bodyVersion = body.params?._meta?.[PROTOCOL_VERSION_META_KEY];
  if (versionHeader !== undefined && typeof bodyVersion === "string") {
    rows.push({
      header: "mcp-protocol-version",
      expected: bodyVersion,
      actual: versionHeader,
      ok: versionHeader === bodyVersion,
    });
  }

  return rows;
}

/** The `header` names from {@link checkHeaderConsistency} rows that mismatched. */
export function mismatchedHeaders(
  entry: Pick<FetchRequestEntry, "requestHeaders" | "requestBody">,
): Set<string> {
  return new Set(
    checkHeaderConsistency(entry)
      .filter((row) => !row.ok)
      .map((row) => row.header),
  );
}

/**
 * Whether an entry's error is a cancellation surfaced as a connection abort.
 * Under the modern transport, cancelling an in-flight request aborts the
 * connection instead of sending a `notifications/cancelled` frame (SEP-2575), so
 * a cancelled request lands here as an `AbortError` rather than a tracked frame.
 */
export function isCancellationAbort(
  entry: Pick<FetchRequestEntry, "error">,
): boolean {
  if (!entry.error) return false;
  const message = entry.error.toLowerCase();
  return message.includes("abort") || message.includes("cancel");
}
