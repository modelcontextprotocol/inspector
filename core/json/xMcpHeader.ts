/**
 * SEP-2243 `x-mcp-header` annotation tooling.
 *
 * A modern (≥2026-07-28) Streamable HTTP server may annotate a tool
 * `inputSchema` property with `x-mcp-header: "{Name}"`; a conforming client then
 * mirrors that argument's value into an `Mcp-Param-{Name}` HTTP header on the
 * `tools/call`. The spec places strict constraints on which properties may carry
 * the annotation, and — crucially for a debugging tool — makes a *violating*
 * annotation invalidate the WHOLE tool: a Streamable HTTP client MUST drop such
 * a tool from `tools/list`.
 *
 * The client SDK enforces that exclusion internally (its `listTools()` silently
 * filters invalid tools), but it does not surface *which* tools were dropped or
 * *why*. This module re-implements the SDK's scan so the Inspector can show
 * excluded tools with their reason, and indicate which args mirror to headers on
 * the tools it keeps. It is a faithful port of the SDK's
 * `scanXMcpHeaderDeclarations` (the helper is not part of the SDK's public
 * surface), kept pure and fully unit-testable — no rendering, no I/O.
 */

import type { Tool } from "@modelcontextprotocol/client";

/** The schema-extension property name a tool's `inputSchema` carries. */
export const X_MCP_HEADER_KEY = "x-mcp-header";

/** The fixed prefix every mirrored custom-parameter header carries. */
export const MCP_PARAM_HEADER_PREFIX = "Mcp-Param-";

/**
 * RFC 9110 §5.1 `token` syntax (`1*tchar`). Rejects empty, space, control
 * characters (including CR/LF), and the listed HTTP delimiters.
 */
const RFC9110_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * JSON Schema `type` values the spec admits on an `x-mcp-header` property.
 *
 * The spec text names `integer`, `string`, `boolean` and explicitly excludes
 * `number`. The published conformance referee at the pinned release ships its
 * `http-custom-headers` scenario with `type: "number"` `x-mcp-header` params and
 * expects the client to mirror them, so the SDK accepts `number` for the
 * conformance gate; this port matches the SDK so exclusions agree exactly.
 * Everything else (`object`, `array`, `null`, absent) is rejected.
 */
const PERMITTED_X_MCP_HEADER_TYPES: ReadonlySet<string> = new Set([
  "string",
  "integer",
  "boolean",
  "number",
]);

/**
 * JSON Schema keywords whose subschemas the static-reachability constraint
 * excludes from the `properties`-only chain. An `x-mcp-header` found under any
 * of these invalidates the tool definition.
 */
const NON_REACHABLE_SUBSCHEMA_KEYWORDS = [
  "items",
  "prefixItems",
  "contains",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "propertyNames",
  "patternProperties",
  "dependentSchemas",
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "$defs",
  "definitions",
] as const;

/**
 * Subschema-carrying keywords whose value is a `name → subschema` object (not a
 * single subschema or array of subschemas). The visit branches over
 * `Object.values()` for these.
 */
const OBJECT_VALUED_SUBSCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
]);

/** One validated `x-mcp-header` declaration found on a tool's input schema. */
export interface XMcpHeaderDeclaration {
  /** The chain of `properties` keys locating the annotated property. */
  path: string[];
  /** The declared header suffix — the `{Name}` in `Mcp-Param-{Name}`. */
  headerName: string;
  /** The property's JSON Schema `type` (a permitted primitive). */
  type: string;
}

/** The result of scanning a tool's input schema for `x-mcp-header` usage. */
export type XMcpHeaderScan =
  | { valid: true; declarations: XMcpHeaderDeclaration[] }
  | { valid: false; reason: string };

function pathName(path: string[]): string {
  return path.length === 0 ? "<root>" : path.join(".");
}

function isRecord(node: unknown): node is Record<string, unknown> {
  return node !== null && typeof node === "object";
}

/**
 * Scan a tool's `inputSchema` for `x-mcp-header` declarations and validate every
 * constraint the spec places on them. Returns the collected declarations
 * (possibly empty) on success, or the first violated constraint's reason.
 *
 * The walk descends through `properties` at any depth (the spec's "any nesting
 * depth" clause). The static-reachability MUST is enforced structurally: every
 * position the chain MUST NOT pass through (`items`/`additionalProperties`,
 * `oneOf`/`anyOf`/`allOf`/`not`, `if`/`then`/`else`, and `$defs`/`definitions`
 * bodies) is visited too, and an `x-mcp-header` found anywhere off the
 * `properties` chain invalidates the schema — "an annotation anywhere else makes
 * the tool definition invalid". `$ref` is never followed: a property reachable
 * only through a `$ref` is therefore correctly treated as non-statically-
 * reachable (its annotation, if any, lives in the unreachable `$defs` body).
 */
export function scanXMcpHeaderDeclarations(
  inputSchema: unknown,
): XMcpHeaderScan {
  const declarations: XMcpHeaderDeclaration[] = [];
  const seenLower = new Map<string, string>();

  const visit = (
    node: unknown,
    path: string[],
    reachable: boolean,
  ): string | undefined => {
    if (!isRecord(node)) return undefined;
    const schema = node;

    if (X_MCP_HEADER_KEY in schema) {
      if (!reachable || path.length === 0) {
        return `${pathName(path)}: x-mcp-header is only permitted on properties statically reachable via a chain of 'properties' keys (not under items, additionalProperties, oneOf/anyOf/allOf/not, if/then/else, or $ref)`;
      }
      const raw = schema[X_MCP_HEADER_KEY];
      if (typeof raw !== "string" || raw.length === 0) {
        return `${pathName(path)}: x-mcp-header MUST be a non-empty string`;
      }
      if (!RFC9110_TOKEN.test(raw)) {
        return `${pathName(path)}: x-mcp-header '${raw}' is not a valid RFC 9110 token (no spaces, control characters or HTTP delimiters)`;
      }
      const type = typeof schema.type === "string" ? schema.type : undefined;
      if (type === undefined || !PERMITTED_X_MCP_HEADER_TYPES.has(type)) {
        return `${pathName(path)}: x-mcp-header is only permitted on primitive-typed properties (string, integer, boolean); got ${type ?? "<none>"}`;
      }
      const lower = raw.toLowerCase();
      const prior = seenLower.get(lower);
      if (prior !== undefined) {
        return `x-mcp-header '${raw}' is not case-insensitively unique (also declared as '${prior}')`;
      }
      seenLower.set(lower, raw);
      declarations.push({ path, headerName: raw, type });
    }

    const properties = schema.properties;
    if (isRecord(properties)) {
      for (const [key, child] of Object.entries(properties)) {
        const fault = visit(child, [...path, key], reachable);
        if (fault !== undefined) return fault;
      }
    }

    for (const k of NON_REACHABLE_SUBSCHEMA_KEYWORDS) {
      const sub = schema[k];
      if (sub === undefined) continue;
      const branches = Array.isArray(sub)
        ? sub
        : isRecord(sub) && OBJECT_VALUED_SUBSCHEMA_KEYWORDS.has(k)
          ? Object.values(sub)
          : [sub];
      for (const branch of branches) {
        const fault = visit(branch, [...path, `<${k}>`], false);
        if (fault !== undefined) return fault;
      }
    }

    return undefined;
  };

  const fault = visit(inputSchema, [], true);
  return fault === undefined
    ? { valid: true, declarations }
    : { valid: false, reason: fault };
}

/** A tool the Inspector keeps, paired with its mirrored-header declarations. */
export interface MirroredHeaderParam {
  /** Dot-joined property path (e.g. `region` or `filter.city`). */
  path: string;
  /** The full header a conforming client sends: `Mcp-Param-{Name}`. */
  header: string;
  /** The declared header suffix. */
  headerName: string;
  /** The property's JSON Schema primitive type. */
  type: string;
}

/**
 * The mirrored-header params for a tool the Inspector kept (its annotations are
 * all valid). Returns `[]` when the tool declares no `x-mcp-header`, and — since
 * a caller only reaches here for *kept* tools — also `[]` for the (unreachable
 * for kept tools) invalid case. Each entry names the arg and the
 * `Mcp-Param-{Name}` header its value mirrors to on a `tools/call`.
 */
export function getMirroredHeaderParams(tool: Tool): MirroredHeaderParam[] {
  const scan = scanXMcpHeaderDeclarations(tool.inputSchema);
  if (!scan.valid) return [];
  return scan.declarations.map((d) => ({
    path: d.path.join("."),
    header: `${MCP_PARAM_HEADER_PREFIX}${d.headerName}`,
    headerName: d.headerName,
    type: d.type,
  }));
}
