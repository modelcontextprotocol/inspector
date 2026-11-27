import { describe, it, expect, vi } from "vitest";
import type { jsonSchemaValidator } from "@modelcontextprotocol/client";
import { createEventPayloadValidator } from "@inspector/core/extension/events/payloadValidation.js";
import { LinearPatternJsonSchemaValidator } from "@inspector/core/mcp/linearPatternValidator.js";
import type { EventType } from "@inspector/core/extension/events/schemas.js";

const typed: EventType = {
  name: "build.finished",
  delivery: ["push"],
  inputSchema: { type: "object" },
  payloadSchema: {
    type: "object",
    properties: { status: { type: "string", enum: ["passed", "failed"] } },
    required: ["status"],
  },
};

describe("createEventPayloadValidator (#3029)", () => {
  it("passes a conforming payload and flags one that is not", () => {
    const validate = createEventPayloadValidator(
      new LinearPatternJsonSchemaValidator(),
    );
    expect(validate(typed, { status: "passed" })).toEqual({ status: "valid" });
    expect(validate(typed, { status: "flaky" })).toEqual({
      status: "invalid",
      error: expect.stringMatching(
        /Payload does not match the payloadSchema of "build.finished"/,
      ),
    });
  });

  it("does not check a type with no payloadSchema", () => {
    const validate = createEventPayloadValidator(
      new LinearPatternJsonSchemaValidator(),
    );
    const untyped: EventType = {
      name: typed.name,
      delivery: typed.delivery,
      inputSchema: typed.inputSchema,
    };
    expect(validate(untyped, { anything: 1 })).toEqual({ status: "unchecked" });
  });

  it("compiles each schema once and never flags against a schema that will not compile", () => {
    const getValidator = vi.fn(() => {
      throw new Error("bad schema");
    });
    const provider: jsonSchemaValidator = { getValidator };
    const validate = createEventPayloadValidator(provider);
    expect(validate(typed, { status: 1 })).toEqual({ status: "unchecked" });
    expect(validate(typed, { status: 2 })).toEqual({ status: "unchecked" });
    expect(getValidator).toHaveBeenCalledTimes(1);
  });
});
