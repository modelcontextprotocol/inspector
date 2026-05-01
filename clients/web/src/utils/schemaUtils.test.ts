import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Tool, JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import {
  cacheToolOutputSchemas,
  getToolOutputValidator,
  validateToolOutput,
  hasOutputSchema,
  generateDefaultValue,
  isPropertyRequired,
  resolveRef,
  normalizeUnionType,
  formatFieldLabel,
  resolveRefsInMessage,
} from "./schemaUtils";

const tool = (overrides: Partial<Tool> = {}): Tool => ({
  name: "tool",
  inputSchema: { type: "object" as const },
  ...overrides,
});

describe("cacheToolOutputSchemas / hasOutputSchema / getToolOutputValidator", () => {
  beforeEach(() => {
    cacheToolOutputSchemas([]);
  });

  it("compiles validators for tools with outputSchema", () => {
    cacheToolOutputSchemas([
      tool({
        name: "alpha",
        outputSchema: {
          type: "object",
          properties: { x: { type: "number" } },
          required: ["x"],
        },
      }),
    ]);
    expect(hasOutputSchema("alpha")).toBe(true);
    expect(typeof getToolOutputValidator("alpha")).toBe("function");
  });

  it("does not register validators for tools without outputSchema", () => {
    cacheToolOutputSchemas([tool({ name: "beta" })]);
    expect(hasOutputSchema("beta")).toBe(false);
    expect(getToolOutputValidator("beta")).toBeUndefined();
  });

  it("clears prior cache between calls", () => {
    cacheToolOutputSchemas([
      tool({ name: "first", outputSchema: { type: "object" } }),
    ]);
    cacheToolOutputSchemas([
      tool({ name: "second", outputSchema: { type: "object" } }),
    ]);
    expect(hasOutputSchema("first")).toBe(false);
    expect(hasOutputSchema("second")).toBe(true);
  });

  it("warns and skips tools whose outputSchema fails to compile", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    cacheToolOutputSchemas([
      tool({
        name: "bad",
        outputSchema: { type: "not-a-real-type" } as never,
      }),
    ]);
    expect(hasOutputSchema("bad")).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("validateToolOutput", () => {
  beforeEach(() => {
    cacheToolOutputSchemas([
      tool({
        name: "withSchema",
        outputSchema: {
          type: "object",
          properties: { count: { type: "number" } },
          required: ["count"],
        },
      }),
    ]);
  });

  it("returns isValid=true for valid content", () => {
    expect(validateToolOutput("withSchema", { count: 5 })).toEqual({
      isValid: true,
    });
  });

  it("returns isValid=false with an error for invalid content", () => {
    const result = validateToolOutput("withSchema", { count: "nope" });
    expect(result.isValid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns isValid=true when no validator is registered", () => {
    expect(validateToolOutput("missing", { x: 1 })).toEqual({ isValid: true });
  });
});

describe("isPropertyRequired", () => {
  it("returns true when property is in required array", () => {
    expect(
      isPropertyRequired("name", { type: "object", required: ["name"] }),
    ).toBe(true);
  });

  it("returns false when property is not in required array", () => {
    expect(
      isPropertyRequired("age", { type: "object", required: ["name"] }),
    ).toBe(false);
  });

  it("returns false when required is undefined", () => {
    expect(isPropertyRequired("x", { type: "object" })).toBe(false);
  });
});

describe("generateDefaultValue", () => {
  it("returns the explicit default when provided", () => {
    expect(generateDefaultValue({ type: "string", default: "x" })).toBe("x");
  });

  it("returns required defaults for primitive types", () => {
    const parent = {
      type: "object" as const,
      required: ["s", "n", "i", "b", "a"],
    };
    expect(generateDefaultValue({ type: "string" }, "s", parent)).toBe("");
    expect(generateDefaultValue({ type: "number" }, "n", parent)).toBe(0);
    expect(generateDefaultValue({ type: "integer" }, "i", parent)).toBe(0);
    expect(generateDefaultValue({ type: "boolean" }, "b", parent)).toBe(false);
    expect(generateDefaultValue({ type: "array" }, "a", parent)).toEqual([]);
  });

  it("returns undefined for optional primitive properties", () => {
    const parent = { type: "object" as const, required: [] };
    expect(
      generateDefaultValue({ type: "string" }, "s", parent),
    ).toBeUndefined();
    expect(
      generateDefaultValue({ type: "number" }, "n", parent),
    ).toBeUndefined();
    expect(
      generateDefaultValue({ type: "boolean" }, "b", parent),
    ).toBeUndefined();
    expect(
      generateDefaultValue({ type: "array" }, "a", parent),
    ).toBeUndefined();
  });

  it("returns null for null type", () => {
    expect(generateDefaultValue({ type: "null" })).toBe(null);
  });

  it("returns {} for required object without properties", () => {
    expect(
      generateDefaultValue({ type: "object" }, "obj", {
        type: "object",
        required: ["obj"],
      }),
    ).toEqual({});
  });

  it("returns {} for root schema object even without required entries", () => {
    expect(generateDefaultValue({ type: "object", properties: {} })).toEqual(
      {},
    );
  });

  it("includes required nested properties", () => {
    const schema = {
      type: "object" as const,
      required: ["name"],
      properties: {
        name: { type: "string" as const },
        age: { type: "number" as const },
      },
    };
    expect(generateDefaultValue(schema)).toEqual({ name: "" });
  });

  it("includes optional properties that declare their own default", () => {
    const schema = {
      type: "object" as const,
      properties: {
        flag: { type: "boolean" as const, default: true },
      },
    };
    expect(generateDefaultValue(schema)).toEqual({ flag: true });
  });

  it("returns undefined for optional object without default-bearing children", () => {
    const schema = {
      type: "object" as const,
      properties: { name: { type: "string" as const } },
    };
    const parent = { type: "object" as const, required: [] };
    expect(generateDefaultValue(schema, "obj", parent)).toBeUndefined();
  });

  it("returns undefined for unknown types", () => {
    expect(generateDefaultValue({ type: "unknown" as never })).toBeUndefined();
  });
});

describe("resolveRef", () => {
  const root = {
    type: "object" as const,
    properties: {
      name: { type: "string" as const },
    },
    $defs: { foo: { type: "string" as const } },
  } as never;

  it("returns the schema unchanged when no $ref", () => {
    expect(resolveRef({ type: "string" }, root)).toEqual({ type: "string" });
  });

  it("resolves a #/properties/<name> reference", () => {
    expect(resolveRef({ $ref: "#/properties/name" }, root)).toEqual({
      type: "string",
    });
  });

  it("returns the original schema when $ref cannot be resolved", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ref = { $ref: "#/properties/nope" };
    expect(resolveRef(ref, root)).toBe(ref);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns the original schema for non-#/ refs", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ref = { $ref: "external.json#/foo" };
    expect(resolveRef(ref, root)).toBe(ref);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("normalizeUnionType", () => {
  it("normalizes anyOf string|null", () => {
    expect(
      normalizeUnionType({
        anyOf: [{ type: "string" }, { type: "null" }],
      }),
    ).toEqual({
      type: "string",
      anyOf: undefined,
      nullable: true,
    });
  });

  it("normalizes anyOf boolean|null", () => {
    expect(
      normalizeUnionType({
        anyOf: [{ type: "boolean" }, { type: "null" }],
      }),
    ).toEqual({
      type: "boolean",
      anyOf: undefined,
      nullable: true,
    });
  });

  it("normalizes anyOf number|null", () => {
    expect(
      normalizeUnionType({
        anyOf: [{ type: "number" }, { type: "null" }],
      }),
    ).toEqual({
      type: "number",
      anyOf: undefined,
      nullable: true,
    });
  });

  it("normalizes anyOf integer|null", () => {
    expect(
      normalizeUnionType({
        anyOf: [{ type: "integer" }, { type: "null" }],
      }),
    ).toEqual({
      type: "integer",
      anyOf: undefined,
      nullable: true,
    });
  });

  it("normalizes anyOf array|null", () => {
    expect(
      normalizeUnionType({
        anyOf: [{ type: "array" }, { type: "null" }],
      }),
    ).toEqual({
      type: "array",
      anyOf: undefined,
      nullable: true,
    });
  });

  it("normalizes type array string|null", () => {
    expect(normalizeUnionType({ type: ["string", "null"] })).toEqual({
      type: "string",
      nullable: true,
    });
  });

  it("normalizes type array boolean|null", () => {
    expect(normalizeUnionType({ type: ["boolean", "null"] })).toEqual({
      type: "boolean",
      nullable: true,
    });
  });

  it("normalizes type array number|null", () => {
    expect(normalizeUnionType({ type: ["number", "null"] })).toEqual({
      type: "number",
      nullable: true,
    });
  });

  it("normalizes type array integer|null", () => {
    expect(normalizeUnionType({ type: ["integer", "null"] })).toEqual({
      type: "integer",
      nullable: true,
    });
  });

  it("returns schema unchanged when no union pattern matches", () => {
    const schema = { type: "string" as const };
    expect(normalizeUnionType(schema)).toBe(schema);
  });

  it("ignores anyOf with more than two members", () => {
    const schema = {
      anyOf: [
        { type: "string" as const },
        { type: "null" as const },
        { type: "number" as const },
      ],
    };
    expect(normalizeUnionType(schema)).toBe(schema);
  });
});

describe("formatFieldLabel", () => {
  it("inserts spaces before capitals and capitalizes first letter", () => {
    expect(formatFieldLabel("firstName")).toBe("First Name");
  });

  it("replaces underscores with spaces", () => {
    expect(formatFieldLabel("first_name")).toBe("First name");
  });

  it("capitalizes a single word", () => {
    expect(formatFieldLabel("hello")).toBe("Hello");
  });
});

describe("resolveRefsInMessage", () => {
  const baseRequest = {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "elicitation/create",
  };

  it("returns the message unchanged when not a request", () => {
    const notification: JSONRPCMessage = {
      jsonrpc: "2.0",
      method: "notifications/foo",
    };
    expect(resolveRefsInMessage(notification)).toBe(notification);
  });

  it("returns the message unchanged when there is no requestedSchema", () => {
    const message: JSONRPCMessage = { ...baseRequest, params: {} };
    expect(resolveRefsInMessage(message)).toBe(message);
  });

  it("returns the message unchanged when requestedSchema has no properties", () => {
    const message: JSONRPCMessage = {
      ...baseRequest,
      params: { requestedSchema: { type: "object" } },
    };
    expect(resolveRefsInMessage(message)).toBe(message);
  });

  it("resolves $ref entries inside requestedSchema.properties", () => {
    const message: JSONRPCMessage = {
      ...baseRequest,
      params: {
        requestedSchema: {
          type: "object",
          properties: {
            name: { $ref: "#/$defs/Name" },
          },
          $defs: { Name: { type: "string" } },
        },
      },
    };
    const resolved = resolveRefsInMessage(message) as typeof message & {
      params: { requestedSchema: { properties: { name: { type: string } } } };
    };
    expect(resolved.params.requestedSchema.properties.name.type).toBe("string");
  });

  it("normalizes union types alongside ref resolution", () => {
    const message: JSONRPCMessage = {
      ...baseRequest,
      params: {
        requestedSchema: {
          type: "object",
          properties: {
            value: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
        },
      },
    };
    const resolved = resolveRefsInMessage(message) as typeof message & {
      params: {
        requestedSchema: {
          properties: { value: { type: string; nullable: boolean } };
        };
      };
    };
    expect(resolved.params.requestedSchema.properties.value).toMatchObject({
      type: "string",
      nullable: true,
    });
  });
});

describe("schemaUtils suppression", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not throw on bad schema compile", () => {
    expect(() =>
      cacheToolOutputSchemas([
        tool({ name: "x", outputSchema: { type: "broken" } as never }),
      ]),
    ).not.toThrow();
  });
});
