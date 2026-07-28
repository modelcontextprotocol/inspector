import { describe, it, expect } from "vitest";
import {
  scanXMcpHeaderDeclarations,
  getMirroredHeaderParams,
  buildMcpParamHeaders,
  mcpParamHeadersForTool,
  MCP_PARAM_HEADER_PREFIX,
  X_MCP_HEADER_KEY,
} from "@inspector/core/json/xMcpHeader.js";
import type { Tool } from "@modelcontextprotocol/client";

function tool(inputSchema: Tool["inputSchema"]): Tool {
  return { name: "t", inputSchema };
}

describe("scanXMcpHeaderDeclarations", () => {
  it("returns valid with no declarations for a schema without annotations", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "integer" } },
    });
    expect(scan).toEqual({ valid: true, declarations: [] });
  });

  it("returns valid for a non-object schema (nothing to scan)", () => {
    expect(scanXMcpHeaderDeclarations(null)).toEqual({
      valid: true,
      declarations: [],
    });
    expect(scanXMcpHeaderDeclarations("nope")).toEqual({
      valid: true,
      declarations: [],
    });
    expect(scanXMcpHeaderDeclarations(undefined)).toEqual({
      valid: true,
      declarations: [],
    });
  });

  it("collects a valid string declaration with its path and header name", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: {
        region: { type: "string", [X_MCP_HEADER_KEY]: "Region" },
      },
    });
    expect(scan).toEqual({
      valid: true,
      declarations: [
        { path: ["region"], headerName: "Region", type: "string" },
      ],
    });
  });

  it("accepts integer, boolean, and number typed properties", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: {
        count: { type: "integer", [X_MCP_HEADER_KEY]: "Count" },
        flag: { type: "boolean", [X_MCP_HEADER_KEY]: "Flag" },
        ratio: { type: "number", [X_MCP_HEADER_KEY]: "Ratio" },
      },
    });
    expect(scan.valid).toBe(true);
    if (scan.valid) {
      expect(scan.declarations.map((d) => d.headerName)).toEqual([
        "Count",
        "Flag",
        "Ratio",
      ]);
    }
  });

  it("collects declarations nested at any depth via properties chains", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: {
        filter: {
          type: "object",
          properties: {
            city: { type: "string", [X_MCP_HEADER_KEY]: "City" },
          },
        },
      },
    });
    expect(scan).toEqual({
      valid: true,
      declarations: [
        { path: ["filter", "city"], headerName: "City", type: "string" },
      ],
    });
  });

  it("rejects an annotation on the root schema (empty path)", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      [X_MCP_HEADER_KEY]: "Root",
    });
    expect(scan.valid).toBe(false);
    if (!scan.valid) expect(scan.reason).toContain("<root>");
  });

  it("rejects a non-string annotation value", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: { a: { type: "string", [X_MCP_HEADER_KEY]: 42 } },
    });
    expect(scan.valid).toBe(false);
    if (!scan.valid) expect(scan.reason).toContain("non-empty string");
  });

  it("rejects an empty-string annotation value", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: { a: { type: "string", [X_MCP_HEADER_KEY]: "" } },
    });
    expect(scan.valid).toBe(false);
    if (!scan.valid) expect(scan.reason).toContain("non-empty string");
  });

  it("rejects a header name that is not an RFC 9110 token", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: {
        a: { type: "string", [X_MCP_HEADER_KEY]: "Not A Token" },
      },
    });
    expect(scan.valid).toBe(false);
    if (!scan.valid) expect(scan.reason).toContain("RFC 9110 token");
  });

  it("rejects a non-primitive typed property", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: {
        a: { type: "object", [X_MCP_HEADER_KEY]: "Obj" },
      },
    });
    expect(scan.valid).toBe(false);
    if (!scan.valid)
      expect(scan.reason).toContain("primitive-typed properties");
  });

  it("rejects a property with a missing type", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: { a: { [X_MCP_HEADER_KEY]: "NoType" } },
    });
    expect(scan.valid).toBe(false);
    if (!scan.valid) expect(scan.reason).toContain("<none>");
  });

  it("rejects two headers that collide case-insensitively", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: {
        a: { type: "string", [X_MCP_HEADER_KEY]: "Region" },
        b: { type: "string", [X_MCP_HEADER_KEY]: "region" },
      },
    });
    expect(scan.valid).toBe(false);
    if (!scan.valid)
      expect(scan.reason).toContain("not case-insensitively unique");
  });

  it("rejects an annotation reachable only under items (array element)", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: {
        list: {
          type: "array",
          items: {
            type: "object",
            properties: {
              x: { type: "string", [X_MCP_HEADER_KEY]: "X" },
            },
          },
        },
      },
    });
    expect(scan.valid).toBe(false);
    if (!scan.valid) expect(scan.reason).toContain("statically reachable");
  });

  it("rejects an annotation under a oneOf branch (array-valued keyword)", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: {
        a: {
          oneOf: [{ type: "string", [X_MCP_HEADER_KEY]: "A" }],
        },
      },
    });
    expect(scan.valid).toBe(false);
    if (!scan.valid) expect(scan.reason).toContain("statically reachable");
  });

  it("rejects an annotation under additionalProperties (single subschema)", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      additionalProperties: {
        type: "string",
        [X_MCP_HEADER_KEY]: "Extra",
      },
    });
    expect(scan.valid).toBe(false);
    if (!scan.valid) expect(scan.reason).toContain("statically reachable");
  });

  it("rejects an annotation under $defs (object-valued keyword)", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      $defs: {
        Thing: { type: "string", [X_MCP_HEADER_KEY]: "Thing" },
      },
    });
    expect(scan.valid).toBe(false);
    if (!scan.valid) expect(scan.reason).toContain("statically reachable");
  });

  it("ignores non-schema (null) branch values in subschema keywords", () => {
    const scan = scanXMcpHeaderDeclarations({
      type: "object",
      properties: {
        a: { type: "string", [X_MCP_HEADER_KEY]: "A" },
      },
      not: null,
    });
    expect(scan.valid).toBe(true);
  });
});

describe("getMirroredHeaderParams", () => {
  it("maps valid declarations to Mcp-Param-{Name} headers", () => {
    const params = getMirroredHeaderParams(
      tool({
        type: "object",
        properties: {
          region: { type: "string", [X_MCP_HEADER_KEY]: "Region" },
          filter: {
            type: "object",
            properties: {
              city: { type: "string", [X_MCP_HEADER_KEY]: "City" },
            },
          },
        },
      }),
    );
    expect(params).toEqual([
      {
        path: "region",
        header: `${MCP_PARAM_HEADER_PREFIX}Region`,
        headerName: "Region",
        type: "string",
      },
      {
        path: "filter.city",
        header: `${MCP_PARAM_HEADER_PREFIX}City`,
        headerName: "City",
        type: "string",
      },
    ]);
  });

  it("returns [] for a tool without annotations", () => {
    expect(
      getMirroredHeaderParams(
        tool({ type: "object", properties: { a: { type: "string" } } }),
      ),
    ).toEqual([]);
  });

  it("returns [] for a tool whose annotations are invalid", () => {
    expect(
      getMirroredHeaderParams(
        tool({
          type: "object",
          properties: { a: { type: "object", [X_MCP_HEADER_KEY]: "A" } },
        }),
      ),
    ).toEqual([]);
  });
});

function declsFor(inputSchema: Tool["inputSchema"]) {
  const scan = scanXMcpHeaderDeclarations(inputSchema);
  if (!scan.valid) throw new Error(`expected valid scan: ${scan.reason}`);
  return scan.declarations;
}

const P = MCP_PARAM_HEADER_PREFIX;

function decodeSentinel(value: string): string {
  const inner = value.slice("=?base64?".length, -"?=".length);
  const bin = atob(inner);
  const bytes = Uint8Array.from(bin, (ch) => ch.codePointAt(0) ?? 0);
  return new TextDecoder().decode(bytes);
}

describe("buildMcpParamHeaders", () => {
  const decls = declsFor({
    type: "object",
    properties: {
      owner: { type: "string", [X_MCP_HEADER_KEY]: "owner" },
      count: { type: "integer", [X_MCP_HEADER_KEY]: "Count" },
      flag: { type: "boolean", [X_MCP_HEADER_KEY]: "Flag" },
      ratio: { type: "number", [X_MCP_HEADER_KEY]: "Ratio" },
    },
  });

  it("mirrors a string argument verbatim into Mcp-Param-{Name}", () => {
    expect(buildMcpParamHeaders(decls, { owner: "octocat" })).toEqual({
      [`${P}owner`]: "octocat",
    });
  });

  it("stringifies boolean and numeric values per the spec", () => {
    expect(
      buildMcpParamHeaders(decls, {
        count: 42,
        flag: false,
        ratio: 3.5,
      }),
    ).toEqual({
      [`${P}Count`]: "42",
      [`${P}Flag`]: "false",
      [`${P}Ratio`]: "3.5",
    });
    expect(buildMcpParamHeaders(decls, { flag: true })).toEqual({
      [`${P}Flag`]: "true",
    });
  });

  it("omits declarations whose value is absent or null", () => {
    expect(buildMcpParamHeaders(decls, { owner: null })).toEqual({});
    expect(buildMcpParamHeaders(decls, {})).toEqual({});
  });

  it("omits non-primitive values rather than emitting malformed headers", () => {
    expect(
      buildMcpParamHeaders(decls, {
        owner: { nested: true },
        count: [1, 2],
      }),
    ).toEqual({});
  });

  it("omits non-finite numbers and unsafe integers", () => {
    expect(buildMcpParamHeaders(decls, { ratio: Infinity })).toEqual({});
    expect(buildMcpParamHeaders(decls, { ratio: NaN })).toEqual({});
    expect(
      buildMcpParamHeaders(decls, { count: Number.MAX_SAFE_INTEGER + 2 }),
    ).toEqual({});
  });

  it("base64-wraps values that are not safe plain-ASCII field values", () => {
    const out = buildMcpParamHeaders(decls, { owner: "münchen" });
    const encoded = out[`${P}owner`];
    expect(encoded.startsWith("=?base64?")).toBe(true);
    expect(encoded.endsWith("?=")).toBe(true);
    expect(decodeSentinel(encoded)).toBe("münchen");
  });

  it("base64-wraps empty, whitespace-padded, and sentinel-colliding values", () => {
    const empty = buildMcpParamHeaders(decls, { owner: "" })[`${P}owner`];
    expect(decodeSentinel(empty)).toBe("");
    const padded = buildMcpParamHeaders(decls, { owner: " x " })[`${P}owner`];
    expect(decodeSentinel(padded)).toBe(" x ");
    const collide = "=?base64?zzz?=";
    const wrapped = buildMcpParamHeaders(decls, { owner: collide })[
      `${P}owner`
    ];
    expect(wrapped).not.toBe(collide);
    expect(decodeSentinel(wrapped)).toBe(collide);
  });

  it("reads a nested property path", () => {
    const nested = declsFor({
      type: "object",
      properties: {
        filter: {
          type: "object",
          properties: {
            city: { type: "string", [X_MCP_HEADER_KEY]: "City" },
          },
        },
      },
    });
    expect(
      buildMcpParamHeaders(nested, { filter: { city: "London" } }),
    ).toEqual({ [`${P}City`]: "London" });
    expect(buildMcpParamHeaders(nested, { filter: "not-an-object" })).toEqual(
      {},
    );
  });
});

describe("mcpParamHeadersForTool", () => {
  it("builds headers for a tool's valid annotations", () => {
    expect(
      mcpParamHeadersForTool(
        tool({
          type: "object",
          properties: {
            owner: { type: "string", [X_MCP_HEADER_KEY]: "owner" },
          },
        }),
        { owner: "octocat" },
      ),
    ).toEqual({ [`${P}owner`]: "octocat" });
  });

  it("returns {} for a tool with no annotations", () => {
    expect(
      mcpParamHeadersForTool(
        tool({ type: "object", properties: { a: { type: "string" } } }),
        { a: "x" },
      ),
    ).toEqual({});
  });

  it("returns {} for a tool whose annotations are invalid", () => {
    expect(
      mcpParamHeadersForTool(
        tool({
          type: "object",
          properties: { a: { type: "object", [X_MCP_HEADER_KEY]: "A" } },
        }),
        { a: "x" },
      ),
    ).toEqual({});
  });
});
