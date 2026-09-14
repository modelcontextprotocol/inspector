import { describe, it, expect } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";
import {
  countFindings,
  describeSchemaPath,
  formatSchemaLintReport,
  lintToolSchemas,
  lintTools,
  summarizeFindings,
  summarizeToolFindings,
  type SchemaFinding,
  type SchemaLintRule,
} from "@inspector/core/json/schemaLint.js";

/**
 * Minimal well-formed tool; each test overrides the schema under test.
 *
 * Overrides are `Record<string, unknown>` rather than `Partial<Tool>` on
 * purpose: the SDK types a tool schema as an *object* schema with a literal
 * `type: "object"`, and the whole point of this suite is to feed the lint the
 * malformed shapes a real server can send — an array-form `type`, a `properties`
 * that is not a map, a root that is a bare boolean. `Partial<Tool>` rejects
 * every one of them, so the fixture accepts the loose shape and narrows once,
 * here, instead of scattering a cast over each case.
 */
function tool(overrides: Record<string, unknown> = {}): Tool {
  return {
    name: "t",
    inputSchema: { type: "object", properties: {} },
    ...overrides,
  } as Tool;
}

/** The rules raised, in order — the shape most assertions here care about. */
function rules(findings: readonly SchemaFinding[]): SchemaLintRule[] {
  return findings.map((f) => f.rule);
}

function paths(findings: readonly SchemaFinding[]): string[] {
  return findings.map((f) => describeSchemaPath(f.schema, f.path));
}

describe("lintToolSchemas — clean schemas", () => {
  it.each([
    ["an empty object schema", { type: "object", properties: {} }],
    [
      "a typed property",
      { type: "object", properties: { a: { type: "string" } } },
    ],
    [
      "an enum property with no type",
      { type: "object", properties: { a: { enum: ["x", "y"] } } },
    ],
    [
      "a const property with no type",
      { type: "object", properties: { a: { const: 3 } } },
    ],
    [
      "a local $ref",
      {
        type: "object",
        properties: { a: { $ref: "#/$defs/x" } },
        $defs: { x: { type: "string" } },
      },
    ],
    [
      "additionalProperties: true",
      { type: "object", properties: {}, additionalProperties: true },
    ],
    [
      "additionalProperties: false",
      { type: "object", properties: {}, additionalProperties: false },
    ],
    [
      "unevaluatedProperties / additionalItems / unevaluatedItems booleans",
      {
        type: "object",
        unevaluatedProperties: false,
        additionalItems: true,
        unevaluatedItems: false,
      },
    ],
    [
      "a shape-implying schema with no type",
      {
        type: "object",
        properties: { a: { properties: { b: { type: "string" } } } },
      },
    ],
    [
      "an anyOf branch set",
      {
        type: "object",
        properties: {
          a: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    ],
    [
      "a typed array with typed items",
      {
        type: "object",
        properties: { a: { type: "array", items: { type: "number" } } },
      },
    ],
  ])("reports nothing for %s", (_label, inputSchema) => {
    expect(lintToolSchemas(tool({ inputSchema }))).toEqual([]);
  });

  it("reports nothing when a tool declares neither schema", () => {
    expect(
      lintToolSchemas(
        tool({ inputSchema: undefined, outputSchema: undefined }),
      ),
    ).toEqual([]);
  });
});

describe("lintToolSchemas — boolean-schema", () => {
  it("flags the Go interface{} case from the issue", () => {
    const findings = lintToolSchemas(
      tool({
        outputSchema: {
          type: "object",
          properties: { data: true, topic: { type: "string" } },
        },
      }),
    );
    expect(rules(findings)).toEqual(["boolean-schema"]);
    expect(paths(findings)).toEqual(["outputSchema.properties.data"]);
    expect(findings[0]!.severity).toBe("error");
    expect(findings[0]!.suggestion).toContain("additionalProperties");
  });

  it("suggests `{}` for a bare true under not, where a typed schema would widen", () => {
    // `{"not": true}` rejects every value. Swapping in `{"type": "object", …}`
    // leaves the parent rejecting only objects, so every non-object would then
    // pass — the enclosing contract is widened, not narrowed. `{}` is the
    // exact replacement, and is exempt from `untyped-schema` in that position.
    const findings = lintToolSchemas(
      tool({
        inputSchema: { type: "object", properties: { a: { not: true } } },
      }),
    );
    expect(rules(findings)).toEqual(["boolean-schema"]);
    expect(findings[0]!.suggestion).toContain("exact replacement");
    expect(findings[0]!.suggestion).not.toContain('"additionalProperties"');
  });

  it("never claims a bare-true replacement narrows the contract", () => {
    // It narrows in an ordinary property position and does not under `not` or
    // `if`, so the wording must not assert an effect it cannot guarantee.
    const findings = lintToolSchemas(
      tool({
        inputSchema: {
          type: "object",
          properties: { a: true, b: { not: true }, c: { if: true } },
        },
      }),
    );
    // Four: a bare `true` in each of the three positions, plus `c` itself
    // being unconstrained — a lone `if` asserts nothing without a `then`.
    expect(rules(findings)).toEqual([
      "boolean-schema",
      "boolean-schema",
      "untyped-schema",
      "boolean-schema",
    ]);
    for (const finding of findings) {
      expect(finding.suggestion).not.toMatch(/narrow/i);
    }
  });

  it("suggests the always-false object form for a bare false", () => {
    // `properties: {a: false}` forbids the property. Deleting the entry would
    // *permit* it with any value under the default `additionalProperties`, so
    // the suggestion has to preserve the constraint rather than drop it.
    const findings = lintToolSchemas(
      tool({
        inputSchema: { type: "object", properties: { data: false } },
      }),
    );
    expect(rules(findings)).toEqual(["boolean-schema"]);
    expect(findings[0]!.suggestion).toContain('{"not": {}}');
    expect(findings[0]!.suggestion).toContain("different contract");
    expect(findings[0]!.suggestion).not.toMatch(/^Remove the property/);
  });

  it('does not flag the `{"not": {}}` form it recommends', () => {
    // The suggestion above would be self-defeating if this module reported its
    // own recommended replacement.
    expect(
      lintToolSchemas(
        tool({
          inputSchema: { type: "object", properties: { data: { not: {} } } },
        }),
      ),
    ).toEqual([]);
  });

  it("still flags an unconstrained schema elsewhere under a not branch", () => {
    // The exemption is scoped to the `not` position itself, not inherited by
    // everything beneath it.
    const findings = lintToolSchemas(
      tool({
        inputSchema: {
          type: "object",
          properties: { a: { not: { properties: { b: {} } } } },
        },
      }),
    );
    expect(rules(findings)).toEqual(["untyped-schema"]);
    expect(paths(findings)).toEqual([
      "inputSchema.properties.a.not.properties.b",
    ]);
  });

  it.each([
    [
      "items",
      { type: "object", properties: { a: { items: true } } },
      "inputSchema.properties.a.items",
    ],
    [
      "an anyOf branch",
      { type: "object", properties: { a: { anyOf: [true] } } },
      "inputSchema.properties.a.anyOf[0]",
    ],
    [
      "a prefixItems entry",
      { type: "object", properties: { a: { prefixItems: [true] } } },
      "inputSchema.properties.a.prefixItems[0]",
    ],
    [
      "a $defs entry",
      { type: "object", $defs: { x: true }, properties: {} },
      "inputSchema.$defs.x",
    ],
    [
      "a patternProperties entry",
      { type: "object", patternProperties: { "^a": true }, properties: {} },
      'inputSchema.patternProperties["^a"]',
    ],
    [
      "a tuple-form items entry",
      { type: "object", properties: { a: { items: [true] } } },
      "inputSchema.properties.a.items[0]",
    ],
    [
      "propertyNames",
      { type: "object", propertyNames: true, properties: {} },
      "inputSchema.propertyNames",
    ],
    [
      "contentSchema",
      {
        type: "object",
        properties: {
          a: {
            type: "string",
            contentMediaType: "application/json",
            contentSchema: true,
          },
        },
      },
      "inputSchema.properties.a.contentSchema",
    ],
    [
      "a dependentSchemas entry",
      { type: "object", dependentSchemas: { a: true }, properties: {} },
      "inputSchema.dependentSchemas.a",
    ],
    [
      "a draft-07 schema-valued dependencies entry",
      { type: "object", dependencies: { a: true }, properties: {} },
      "inputSchema.dependencies.a",
    ],
    ["the schema root", true, "inputSchema"],
  ])("flags a bare boolean under %s", (_label, inputSchema, path) => {
    const findings = lintToolSchemas(tool({ inputSchema }));
    expect(rules(findings)).toEqual(["boolean-schema"]);
    expect(paths(findings)).toEqual([path]);
  });

  it("quotes a non-identifier property name in the path", () => {
    const findings = lintToolSchemas(
      tool({
        inputSchema: { type: "object", properties: { "odd key": true } },
      }),
    );
    expect(paths(findings)).toEqual(['inputSchema.properties["odd key"]']);
  });
});

describe("lintToolSchemas — type-union", () => {
  it("flags the nullable array form and suggests anyOf branches", () => {
    const findings = lintToolSchemas(
      tool({
        inputSchema: {
          type: "object",
          properties: { show_ids: { type: ["null", "boolean"] } },
        },
      }),
    );
    expect(rules(findings)).toEqual(["type-union"]);
    expect(findings[0]!.severity).toBe("warning");
    expect(findings[0]!.suggestion).toContain(
      '{"anyOf": [{"type": "null"}, {"type": "boolean"}]}',
    );
  });

  it("never suggests un-requiring the property as the equivalent fix", () => {
    // Absent and `null` are different contracts, so "drop it from `required`"
    // is not a portable spelling of the same schema — it is a change to it.
    const findings = lintToolSchemas(
      tool({
        inputSchema: {
          type: "object",
          properties: { a: { type: ["null", "string"] } },
        },
      }),
    );
    expect(findings[0]!.suggestion).toContain("absent is not the same as");
    expect(findings[0]!.suggestion).not.toMatch(/leave the property out/);
  });

  it("keeps every member in the suggestion when none is null", () => {
    const findings = lintToolSchemas(
      tool({
        inputSchema: {
          type: "object",
          properties: { a: { type: ["string", "number"] } },
        },
      }),
    );
    expect(findings[0]!.suggestion).toContain(
      '{"anyOf": [{"type": "string"}, {"type": "number"}]}',
    );
  });

  it.each([
    ["an empty array, which matches nothing", []],
    ["a non-string member", ["string", 3]],
    ["only non-string members", [3]],
    ["an unrecognized type name", ["string", "bananas"]],
    ["a duplicated member", ["string", "string"]],
  ])("stays quiet on a malformed type array — %s", (_label, type) => {
    // The rule's message asserts the construct is *legal* JSON Schema, and the
    // `anyOf` it suggests would be invalid for these. Malformed schemas are
    // the SDK parser's business, the same way a non-schema node is.
    expect(
      lintToolSchemas(
        tool({ inputSchema: { type: "object", properties: { a: { type } } } }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["integer", ["integer", "null"]],
    ["array", ["array", "null"]],
    ["object", ["object", "string"]],
  ])("still fires for a well-formed union containing %s", (_label, type) => {
    const findings = lintToolSchemas(
      tool({ inputSchema: { type: "object", properties: { a: { type } } } }),
    );
    expect(rules(findings)).toEqual(["type-union"]);
  });

  it("raises only the union rule for an array-typed root", () => {
    const findings = lintToolSchemas(
      tool({ inputSchema: { type: ["object", "null"] } }),
    );
    expect(rules(findings)).toEqual(["type-union"]);
  });
});

describe("lintToolSchemas — untyped-schema", () => {
  it.each([
    ["an empty schema", {}],
    ["an annotation-only schema", { description: "anything at all" }],
    [
      "a title/default-only schema",
      { title: "T", default: 1, examples: [1], deprecated: false },
    ],
  ])("flags %s", (_label, sub) => {
    const findings = lintToolSchemas(
      tool({
        inputSchema: { type: "object", properties: { a: sub } },
      }),
    );
    expect(rules(findings)).toEqual(["untyped-schema"]);
    expect(paths(findings)).toEqual(["inputSchema.properties.a"]);
  });

  it("flags a schema whose only keyword is unrecognized", () => {
    // JSON Schema ignores keywords it does not know, so `{"vendorHint": true}`
    // accepts every value. A denylist of known annotations would let it pass
    // simply because the keyword is unfamiliar — hence the allowlist.
    const findings = lintToolSchemas(
      tool({
        inputSchema: {
          type: "object",
          properties: { a: { vendorHint: true, "x-internal": 1 } },
        },
      }),
    );
    expect(rules(findings)).toEqual(["untyped-schema"]);
  });

  it("flags a definition-only schema", () => {
    // `$defs` holds subschemas for *other* schemas to reference; it constrains
    // the current instance not at all.
    const findings = lintToolSchemas(
      tool({
        inputSchema: {
          type: "object",
          properties: { a: { $defs: { x: { type: "string" } } } },
        },
      }),
    );
    expect(rules(findings)).toEqual(["untyped-schema"]);
    expect(paths(findings)).toEqual(["inputSchema.properties.a"]);
  });

  it.each([
    ["a lone if", { if: { const: 1 } }],
    ["a lone then", { then: { type: "string" } }],
    ["a lone else", { else: { type: "string" } }],
  ])("flags %s, which asserts nothing on its own", (_label, sub) => {
    // `if` has no assertion effect without `then`/`else`, and either of those
    // is ignored without an `if` — so these accept every value, and counting
    // the keyword's mere presence would let them pass as constrained.
    const findings = lintToolSchemas(
      tool({ inputSchema: { type: "object", properties: { a: sub } } }),
    );
    expect(rules(findings)).toEqual(["untyped-schema"]);
  });

  it.each([
    ["if + then", { if: { const: 1 }, then: { type: "string" } }],
    ["if + else", { if: { const: 1 }, else: { type: "string" } }],
  ])("does not flag %s, which is a real conditional", (_label, sub) => {
    expect(
      lintToolSchemas(
        tool({ inputSchema: { type: "object", properties: { a: sub } } }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["pattern", { pattern: "^a" }],
    ["format", { format: "email" }],
    ["required", { required: ["a"] }],
    ["minimum", { minimum: 0 }],
    ["contains", { contains: { type: "string" } }],
    ["propertyNames", { propertyNames: { pattern: "^a" } }],
    ["dependentRequired", { dependentRequired: { a: ["b"] } }],
    ["contentMediaType", { contentMediaType: "application/json" }],
    ["contentEncoding", { contentEncoding: "base64" }],
    ["contentSchema", { contentSchema: { type: "object" } }],
  ])("does not flag a schema constrained only by %s", (_label, sub) => {
    const findings = lintToolSchemas(
      tool({ inputSchema: { type: "object", properties: { a: sub } } }),
    );
    expect(findings).toEqual([]);
  });

  it("flags an entirely empty root schema", () => {
    const findings = lintToolSchemas(tool({ inputSchema: {} }));
    expect(rules(findings)).toEqual(["untyped-schema"]);
    expect(paths(findings)).toEqual(["inputSchema"]);
  });
});

describe("lintToolSchemas — no root-type rule", () => {
  // There is deliberately no "inputSchema must be an object" rule: the SDK
  // types `inputSchema` with `type: literal("object")`, so such a tool fails
  // `ListToolsResultSchema` and `salvageListItems` drops it before any client
  // sees it. `raw-tool-schemas.test.ts` pins that live behaviour; these cases
  // pin that the module stays quiet rather than reporting a check nothing can
  // reach.
  it.each([
    ["a non-object inputSchema root", { inputSchema: { type: "array" } }],
    ["a non-object outputSchema root", { outputSchema: { type: "string" } }],
    [
      "a nested non-object schema",
      {
        inputSchema: {
          type: "object",
          properties: { a: { type: "array", items: { type: "string" } } },
        },
      },
    ],
  ])("reports nothing for %s", (_label, overrides) => {
    expect(lintToolSchemas(tool(overrides))).toEqual([]);
  });
});

describe("lintToolSchemas — remote-ref", () => {
  it.each([
    ["an https ref", "https://example.com/schema.json"],
    ["a sibling-file ref", "common.json#/$defs/x"],
  ])("flags %s", (_label, ref) => {
    const findings = lintToolSchemas(
      tool({
        inputSchema: { type: "object", properties: { a: { $ref: ref } } },
      }),
    );
    expect(rules(findings)).toEqual(["remote-ref"]);
    expect(findings[0]!.issue).toContain(ref);
  });

  it("stays quiet when the document declares an $id", () => {
    // With a root `$id`, `https://example.com/root#/$defs/x` resolves to THIS
    // document and needs no fetch — so the finding, and its "inline the
    // referenced schema" remediation, would both be wrong. Classifying refs
    // correctly here needs full base-URI resolution, which this module does
    // not do, so it declines rather than guessing.
    expect(
      lintToolSchemas(
        tool({
          inputSchema: {
            $id: "https://example.com/root",
            type: "object",
            properties: { a: { $ref: "https://example.com/root#/$defs/x" } },
            $defs: { x: { type: "string" } },
          },
        }),
      ),
    ).toEqual([]);
  });

  it("finds an $id declared on a nested subschema too", () => {
    // The base URI can be established by an embedded resource, not just the
    // root, so the scan has to reach the whole document.
    expect(
      lintToolSchemas(
        tool({
          inputSchema: {
            type: "object",
            properties: {
              a: { $id: "https://example.com/embedded", type: "object" },
              b: { $ref: "https://example.com/embedded#/x" },
            },
          },
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["examples", { examples: [{ $id: "payload-field" }] }],
    ["default", { default: { $id: "payload-field" } }],
    ["const", { const: { $id: "payload-field" } }],
    ["enum", { enum: [{ $id: "payload-field" }] }],
  ])(
    "is not disabled by an $id that is instance data under %s",
    (_label, dataCarrier) => {
      // `$id` inside `examples`/`default`/`const`/`enum` is a payload key, not
      // an embedded schema resource — reading one there would switch this rule
      // off for the whole document.
      const findings = lintToolSchemas(
        tool({
          inputSchema: {
            type: "object",
            properties: {
              a: { type: "string", ...dataCarrier },
              b: { $ref: "https://example.com/s.json" },
            },
          },
        }),
      );
      expect(rules(findings)).toEqual(["remote-ref"]);
    },
  );

  it("still fires when no $id is declared anywhere", () => {
    const findings = lintToolSchemas(
      tool({
        inputSchema: {
          type: "object",
          properties: { a: { $ref: "https://example.com/root#/$defs/x" } },
        },
      }),
    );
    expect(rules(findings)).toEqual(["remote-ref"]);
  });

  it("ignores an empty $ref rather than calling it remote", () => {
    const findings = lintToolSchemas(
      tool({
        inputSchema: { type: "object", properties: { a: { $ref: "" } } },
      }),
    );
    expect(findings).toEqual([]);
  });
});

describe("lintToolSchemas — walk robustness", () => {
  it("skips a value that is not a schema at all", () => {
    const findings = lintToolSchemas(
      tool({
        inputSchema: { type: "object", properties: { a: "nonsense" } },
      }),
    );
    expect(findings).toEqual([]);
  });

  it("skips the draft-07 property-name-array form of dependencies", () => {
    // `dependencies: {a: ["b"]}` is a required-property list, not a schema
    // position, so the walk must not descend into it.
    const findings = lintToolSchemas(
      tool({
        inputSchema: {
          type: "object",
          properties: { a: { type: "string" }, b: { type: "string" } },
          dependencies: { a: ["b"] },
        },
      }),
    );
    expect(findings).toEqual([]);
  });

  it("skips keyword values of the wrong shape", () => {
    const findings = lintToolSchemas(
      tool({
        inputSchema: {
          type: "object",
          properties: "not-a-map",
          anyOf: "not-an-array",
        },
      }),
    );
    expect(findings).toEqual([]);
  });

  it("stops at the depth cap instead of recursing forever", () => {
    // 200 nested `items`, deeper than MAX_DEPTH (64), each level clean; the
    // bare `true` at the bottom sits past the cap and is therefore not
    // reported. The assertion is that the walk terminates and stays quiet.
    let nested: unknown = true;
    for (let i = 0; i < 200; i++) nested = { type: "array", items: nested };
    const findings = lintToolSchemas(
      tool({
        inputSchema: { type: "object", properties: { a: nested } },
      }),
    );
    expect(findings).toEqual([]);
  });

  it("walks both schemas, inputSchema first", () => {
    const findings = lintToolSchemas(
      tool({
        inputSchema: { type: "object", properties: { a: true } },
        outputSchema: { type: "object", properties: { b: true } },
      }),
    );
    expect(paths(findings)).toEqual([
      "inputSchema.properties.a",
      "outputSchema.properties.b",
    ]);
  });
});

describe("lintTools", () => {
  it("drops clean tools and keeps the rest in list order", () => {
    const results = lintTools([
      tool({ name: "clean" }),
      tool({
        name: "dirty",
        inputSchema: { type: "object", properties: { a: true } },
      }),
      tool({ name: "also-clean" }),
    ]);
    expect(results.map((r) => r.toolName)).toEqual(["dirty"]);
    expect(results[0]!.findings).toHaveLength(1);
  });

  it("returns an empty list when everything is clean", () => {
    expect(lintTools([tool(), tool({ name: "b" })])).toEqual([]);
  });
});

describe("reporting helpers", () => {
  const results = lintTools([
    tool({
      name: "info",
      inputSchema: {
        type: "object",
        properties: { show_ids: { type: ["null", "boolean"] } },
      },
      outputSchema: { type: "object", properties: { data: true } },
    }),
  ]);

  it("counts by severity", () => {
    expect(countFindings(results)).toEqual({ errors: 1, warnings: 1 });
  });

  it("counts nothing for an empty result", () => {
    expect(countFindings([])).toEqual({ errors: 0, warnings: 0 });
  });

  it("summarizes with singular nouns at one", () => {
    expect(summarizeFindings(results)).toBe("1 error, 1 warning across 1 tool");
  });

  it("pluralizes above one", () => {
    const two = lintTools([
      tool({
        name: "a",
        inputSchema: { type: "object", properties: { x: true, y: true } },
      }),
      tool({
        name: "b",
        inputSchema: { type: "object", properties: { x: true } },
      }),
    ]);
    expect(summarizeFindings(two)).toBe("3 errors, 0 warnings across 2 tools");
  });

  it("renders a report with a path, issue and suggestion per finding", () => {
    const report = formatSchemaLintReport(results);
    expect(report).toContain('Error: tool "info"');
    expect(report).toContain('Warning: tool "info"');
    expect(report).toContain("Path: outputSchema.properties.data");
    expect(report).toContain("Path: inputSchema.properties.show_ids");
    expect(report).toContain("Issue: ");
    expect(report).toContain("Suggestion: ");
    expect(report.trimEnd().endsWith("1 error, 1 warning across 1 tool.")).toBe(
      true,
    );
  });

  it("renders a zero summary for an empty result", () => {
    expect(formatSchemaLintReport([])).toBe(
      "0 errors, 0 warnings across 0 tools.",
    );
  });
});

describe("summarizeToolFindings", () => {
  const mixed = lintToolSchemas(
    tool({
      inputSchema: {
        type: "object",
        properties: {
          a: { type: ["null", "boolean"] },
          b: {},
          c: { $ref: "https://example.com/s.json" },
        },
      },
      outputSchema: { type: "object", properties: { data: true } },
    }),
  );

  it("breaks a mixed tool down instead of labelling the total", () => {
    // The defect this replaced: one error plus three warnings announced as
    // "4 schema portability errors".
    expect(mixed).toHaveLength(4);
    expect(summarizeToolFindings(mixed)).toBe("1 error, 3 warnings");
  });

  it("omits a category with no findings", () => {
    const warnOnly = lintToolSchemas(
      tool({
        inputSchema: {
          type: "object",
          properties: { a: { type: ["null", "boolean"] } },
        },
      }),
    );
    expect(summarizeToolFindings(warnOnly)).toBe("1 warning");
  });

  it("reads as errors only when that is all there is", () => {
    const errOnly = lintToolSchemas(
      tool({
        inputSchema: { type: "object", properties: { a: true, b: true } },
      }),
    );
    expect(summarizeToolFindings(errOnly)).toBe("2 errors");
  });

  it("is empty for a clean tool", () => {
    expect(summarizeToolFindings([])).toBe("");
  });
});

describe("describeSchemaPath", () => {
  it("names the schema alone at the root", () => {
    expect(describeSchemaPath("inputSchema", "")).toBe("inputSchema");
  });

  it("joins a nested path onto the schema name", () => {
    expect(describeSchemaPath("outputSchema", "properties.a")).toBe(
      "outputSchema.properties.a",
    );
  });
});
