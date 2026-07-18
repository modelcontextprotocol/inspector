import { describe, expect, it } from "vitest";
import {
  checkHeaderConsistency,
  classifyMcpSpecError,
  classifyProtocolSpecError,
  decodeMcpParamValue,
  HEADER_MISMATCH_ERROR_CODE,
  isCancellationAbort,
  isLegacyBare404,
  isMcpHeader,
  isMcpParamHeader,
  isMcpStandardHeader,
  mismatchedHeaders,
  parseJsonRpcError,
  PROTOCOL_VERSION_META_KEY,
} from "./mcpNetworkHeaders";

/** Mirror of the SDK's sentinel encoding, for building test inputs. */
function encodeSentinel(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?base64?${btoa(bin)}?=`;
}

describe("header name recognition", () => {
  it("recognises standard mirrored headers case-insensitively", () => {
    expect(isMcpStandardHeader("Mcp-Method")).toBe(true);
    expect(isMcpStandardHeader("mcp-name")).toBe(true);
    expect(isMcpStandardHeader("MCP-Protocol-Version")).toBe(true);
    expect(isMcpStandardHeader("content-type")).toBe(false);
  });

  it("recognises Mcp-Param-* headers", () => {
    expect(isMcpParamHeader("Mcp-Param-City")).toBe(true);
    expect(isMcpParamHeader("mcp-param-x")).toBe(true);
    expect(isMcpParamHeader("mcp-method")).toBe(false);
  });

  it("isMcpHeader covers both families", () => {
    expect(isMcpHeader("mcp-method")).toBe(true);
    expect(isMcpHeader("Mcp-Param-Foo")).toBe(true);
    expect(isMcpHeader("authorization")).toBe(false);
  });
});

describe("decodeMcpParamValue", () => {
  it("passes plain ASCII values through unchanged", () => {
    expect(decodeMcpParamValue("tools/call")).toEqual({
      value: "tools/call",
      encoded: false,
      raw: "tools/call",
    });
  });

  it("decodes a base64 sentinel value (incl. non-ASCII)", () => {
    const raw = encodeSentinel("café ☕");
    expect(decodeMcpParamValue(raw)).toEqual({
      value: "café ☕",
      encoded: true,
      raw,
    });
  });

  it("decodes an empty sentinel payload", () => {
    const raw = encodeSentinel("");
    expect(decodeMcpParamValue(raw)).toEqual({ value: "", encoded: true, raw });
  });

  it("reports encoded but keeps the raw when the payload is not valid base64", () => {
    const raw = "=?base64?not!base64!?=";
    const result = decodeMcpParamValue(raw);
    expect(result.encoded).toBe(true);
    expect(result.raw).toBe(raw);
  });

  it("does not treat a too-short lookalike as a sentinel", () => {
    expect(decodeMcpParamValue("?=").encoded).toBe(false);
  });
});

describe("parseJsonRpcError", () => {
  it("returns null for empty / non-JSON / non-error bodies", () => {
    expect(parseJsonRpcError(undefined)).toBeNull();
    expect(parseJsonRpcError("")).toBeNull();
    expect(parseJsonRpcError("not json")).toBeNull();
    expect(
      parseJsonRpcError('{"jsonrpc":"2.0","id":1,"result":{}}'),
    ).toBeNull();
  });

  it("extracts a JSON-RPC error object", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32020, message: "header mismatch", data: { x: 1 } },
    });
    expect(parseJsonRpcError(body)).toEqual({
      code: -32020,
      message: "header mismatch",
      data: { x: 1 },
    });
  });

  it("defaults a missing message to empty string", () => {
    const body = JSON.stringify({ error: { code: -32601 } });
    expect(parseJsonRpcError(body)).toEqual({
      code: -32601,
      message: "",
      data: undefined,
    });
  });

  it("finds the first error in a batched response", () => {
    const body = JSON.stringify([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 2, error: { code: -32021, message: "cap" } },
    ]);
    expect(parseJsonRpcError(body)?.code).toBe(-32021);
  });

  it("ignores an error object with a non-numeric code", () => {
    const body = JSON.stringify({ error: { code: "nope", message: "x" } });
    expect(parseJsonRpcError(body)).toBeNull();
  });

  it("ignores a null error and non-object candidates", () => {
    expect(parseJsonRpcError(JSON.stringify({ error: null }))).toBeNull();
    expect(parseJsonRpcError(JSON.stringify([null, 5]))).toBeNull();
  });
});

describe("classifyMcpSpecError", () => {
  it("classifies -32020 HeaderMismatch on a 400", () => {
    const err = classifyMcpSpecError({
      responseStatus: 400,
      responseBody: JSON.stringify({
        error: { code: HEADER_MISMATCH_ERROR_CODE },
      }),
    });
    expect(err?.name).toBe("HeaderMismatch");
    expect(err?.expectedHttpStatus).toBe(400);
    expect(err?.actualHttpStatus).toBe(400);
  });

  it("classifies -32022 and extracts supported versions", () => {
    const err = classifyMcpSpecError({
      responseStatus: 400,
      responseBody: JSON.stringify({
        error: {
          code: -32022,
          data: { supported: ["2025-11-25", "2026-07-28", 5] },
        },
      }),
    });
    expect(err?.name).toBe("UnsupportedProtocolVersion");
    expect(err?.supported).toEqual(["2025-11-25", "2026-07-28"]);
  });

  it("omits supported when data is missing or malformed", () => {
    const err = classifyMcpSpecError({
      responseStatus: 400,
      responseBody: JSON.stringify({ error: { code: -32022, data: {} } }),
    });
    expect(err?.supported).toBeUndefined();
  });

  it("treats -32601 on a 404 as the modern method-not-found marker", () => {
    const err = classifyMcpSpecError({
      responseStatus: 404,
      responseBody: JSON.stringify({ error: { code: -32601 } }),
    });
    expect(err?.name).toBe("MethodNotFound");
    expect(err?.expectedHttpStatus).toBe(404);
  });

  it("does NOT classify an in-band -32601 on a 200", () => {
    expect(
      classifyMcpSpecError({
        responseStatus: 200,
        responseBody: JSON.stringify({ error: { code: -32601 } }),
      }),
    ).toBeNull();
  });

  it("returns null for a non-spec error code", () => {
    expect(
      classifyMcpSpecError({
        responseStatus: 500,
        responseBody: JSON.stringify({ error: { code: -32603 } }),
      }),
    ).toBeNull();
  });

  it("returns null when there is no error body", () => {
    expect(
      classifyMcpSpecError({ responseStatus: 200, responseBody: "{}" }),
    ).toBeNull();
  });
});

describe("classifyProtocolSpecError", () => {
  it("classifies by code alone (no HTTP status), incl. -32601", () => {
    expect(classifyProtocolSpecError(-32601)?.name).toBe("MethodNotFound");
    expect(classifyProtocolSpecError(HEADER_MISMATCH_ERROR_CODE)?.name).toBe(
      "HeaderMismatch",
    );
  });

  it("extracts supported versions for -32022", () => {
    expect(
      classifyProtocolSpecError(-32022, { supported: ["2026-07-28"] })
        ?.supported,
    ).toEqual(["2026-07-28"]);
  });

  it("returns null for a non-spec code", () => {
    expect(classifyProtocolSpecError(-32000)).toBeNull();
  });
});

describe("isLegacyBare404", () => {
  it("is true for a 404 with no JSON-RPC body", () => {
    expect(
      isLegacyBare404({ responseStatus: 404, responseBody: "Not Found" }),
    ).toBe(true);
    expect(
      isLegacyBare404({ responseStatus: 404, responseBody: undefined }),
    ).toBe(true);
  });

  it("is false for a modern -32601 404 or a non-404", () => {
    expect(
      isLegacyBare404({
        responseStatus: 404,
        responseBody: JSON.stringify({ error: { code: -32601 } }),
      }),
    ).toBe(false);
    expect(isLegacyBare404({ responseStatus: 200, responseBody: "" })).toBe(
      false,
    );
  });
});

describe("checkHeaderConsistency", () => {
  const version = "2026-07-28";

  it("returns [] when the body is not a JSON-RPC request", () => {
    expect(
      checkHeaderConsistency({ requestHeaders: {}, requestBody: "not json" }),
    ).toEqual([]);
    expect(
      checkHeaderConsistency({ requestHeaders: {}, requestBody: "[1,2]" }),
    ).toEqual([]);
  });

  it("reports agreeing headers as ok", () => {
    const rows = checkHeaderConsistency({
      requestHeaders: {
        "mcp-method": "tools/call",
        "mcp-name": encodeSentinel("get_weather"),
        "mcp-protocol-version": version,
      },
      requestBody: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_weather",
          _meta: { [PROTOCOL_VERSION_META_KEY]: version },
        },
      }),
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.ok)).toBe(true);
  });

  it("flags a method mismatch and a name mismatch", () => {
    const rows = checkHeaderConsistency({
      requestHeaders: {
        "mcp-method": "tools/list",
        "mcp-name": "wrong_tool",
      },
      requestBody: JSON.stringify({
        method: "tools/call",
        params: { name: "get_weather" },
      }),
    });
    const byHeader = Object.fromEntries(rows.map((r) => [r.header, r]));
    expect(byHeader["mcp-method"].ok).toBe(false);
    expect(byHeader["mcp-method"].expected).toBe("tools/call");
    expect(byHeader["mcp-name"].ok).toBe(false);
  });

  it("uses params.uri for mcp-name on resources/read", () => {
    const rows = checkHeaderConsistency({
      requestHeaders: { "mcp-name": "file:///a.txt" },
      requestBody: JSON.stringify({
        method: "resources/read",
        params: { uri: "file:///a.txt" },
      }),
    });
    expect(rows[0]).toMatchObject({ header: "mcp-name", ok: true });
  });

  it("skips headers with no derivable body counterpart", () => {
    const rows = checkHeaderConsistency({
      requestHeaders: { "mcp-protocol-version": version },
      requestBody: JSON.stringify({ method: "ping", params: {} }),
    });
    // No _meta version in the body → the version row is skipped, not flagged.
    expect(
      rows.find((r) => r.header === "mcp-protocol-version"),
    ).toBeUndefined();
  });

  it("mismatchedHeaders returns only the failing header names", () => {
    const set = mismatchedHeaders({
      requestHeaders: { "mcp-method": "tools/list" },
      requestBody: JSON.stringify({ method: "tools/call", params: {} }),
    });
    expect(set.has("mcp-method")).toBe(true);
    expect(set.size).toBe(1);
  });
});

describe("isCancellationAbort", () => {
  it("detects abort / cancellation error text", () => {
    expect(isCancellationAbort({ error: "The operation was aborted" })).toBe(
      true,
    );
    expect(isCancellationAbort({ error: "Request cancelled by user" })).toBe(
      true,
    );
  });

  it("is false for other errors or no error", () => {
    expect(isCancellationAbort({ error: "ECONNREFUSED" })).toBe(false);
    expect(isCancellationAbort({ error: undefined })).toBe(false);
  });
});
