import { describe, it, expect } from "vitest";
import type { CreateMessageRequest } from "@modelcontextprotocol/client";
import {
  DEFAULT_SAMPLING_MODEL,
  SAMPLING_RESPONSE_FORM,
  describeSamplingRequest,
  elicitationContentFromForm,
  elicitationForm,
  elicitationUrlRefusal,
  messageBoxHeight,
  normalizeElicitationSchema,
  samplingResultFromForm,
  type ElicitFormParams,
} from "../src/utils/pendingRequests.js";

type SamplingParams = CreateMessageRequest["params"];
type Schema = ElicitFormParams["requestedSchema"];

describe("samplingResultFromForm", () => {
  it("builds an assistant text result from the submitted fields", () => {
    expect(
      samplingResultFromForm({
        text: "hi there",
        model: "  my-model ",
        stopReason: "maxTokens",
      }),
    ).toEqual({
      role: "assistant",
      model: "my-model",
      stopReason: "maxTokens",
      content: { type: "text", text: "hi there" },
    });
  });

  it("falls back to the defaults for missing or blank fields", () => {
    expect(samplingResultFromForm({ model: "   " })).toEqual({
      role: "assistant",
      model: DEFAULT_SAMPLING_MODEL,
      stopReason: "endTurn",
      content: { type: "text", text: "" },
    });
  });

  it("pre-fills the model and stop reason in the form", () => {
    const fields = SAMPLING_RESPONSE_FORM.sections[0]!.fields as Array<{
      name: string;
      initialValue?: unknown;
    }>;
    expect(fields.find((f) => f.name === "model")?.initialValue).toBe(
      DEFAULT_SAMPLING_MODEL,
    );
    expect(fields.find((f) => f.name === "stopReason")?.initialValue).toBe(
      "endTurn",
    );
  });
});

describe("describeSamplingRequest", () => {
  it("lists the system prompt, budget, hints and each message", () => {
    const params = {
      systemPrompt: "Be terse",
      maxTokens: 100,
      modelPreferences: { hints: [{ name: "claude" }, {}] },
      messages: [
        { role: "user", content: { type: "text", text: "line1\nline2" } },
        {
          role: "assistant",
          content: [
            { type: "image", data: "x", mimeType: "image/png" },
            { type: "tool_use", id: "1", name: "search", input: {} },
            { type: "tool_result", toolUseId: "1", content: [] },
          ],
        },
      ],
    } as unknown as SamplingParams; // a fixture spanning block shapes the SDK types per-era
    expect(describeSamplingRequest(params)).toEqual([
      "System prompt: Be terse",
      "Max tokens: 100",
      "Model hints: claude",
      "",
      "user: line1",
      "  line2",
      "assistant: [image: image/png] [tool_use: search] [tool_result]",
    ]);
  });

  it("omits what the request leaves out and tolerates odd blocks", () => {
    const params = {
      maxTokens: 5,
      messages: [{ role: "user", content: [null, {}] }],
    } as unknown as SamplingParams; // deliberately malformed blocks
    expect(describeSamplingRequest(params)).toEqual([
      "Max tokens: 5",
      "",
      "user: null [unknown]",
    ]);
  });
});

describe("normalizeElicitationSchema", () => {
  it("turns titled single and multi selects into enum + enumNames", () => {
    const schema = {
      type: "object",
      properties: {
        color: {
          type: "string",
          oneOf: [{ const: "r", title: "Red" }, { const: "g" }],
        },
        tags: {
          type: "array",
          items: { anyOf: [{ const: "a", title: "Alpha" }] },
        },
        name: { type: "string" },
        bad: { type: "string", oneOf: [{ const: 1 }] },
        notObject: { type: "string", oneOf: ["x"] },
        empty: { type: "string", oneOf: [] },
      },
    } as unknown as Schema; // titled enums plus malformed members
    const out = normalizeElicitationSchema(schema).properties as Record<
      string,
      unknown
    >;
    expect(out.color).toEqual({
      type: "string",
      enum: ["r", "g"],
      enumNames: ["Red", "g"],
    });
    expect(out.tags).toEqual({
      type: "array",
      items: { enum: ["a"], enumNames: ["Alpha"] },
    });
    expect(out.name).toEqual({ type: "string" });
    expect(out.bad).toEqual({ type: "string", oneOf: [{ const: 1 }] });
    expect(out.notObject).toEqual({ type: "string", oneOf: ["x"] });
    expect(out.empty).toEqual({ type: "string", oneOf: [] });
  });
});

describe("elicitationForm", () => {
  it("renders the schema as a titleless Response section", () => {
    const form = elicitationForm({
      type: "object",
      properties: { name: { type: "string", title: "Your name" } },
      required: ["name"],
    });
    expect(form.title).toBeUndefined();
    expect(form.sections[0]!.title).toBe("Response");
    expect(form.sections[0]!.fields[0]).toMatchObject({
      name: "name",
      label: "Your name",
      required: true,
    });
  });
});

describe("elicitationContentFromForm", () => {
  const schema: Schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "integer" },
      tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
      ok: { type: "boolean" },
      note: { type: "string" },
    },
    required: ["name"],
  };

  it("accepts a multi-select's chosen values as the array (#2904)", () => {
    expect(
      elicitationContentFromForm(schema, { name: "Ada", tags: ["a", "b"] }),
    ).toEqual({
      result: { action: "accept", content: { name: "Ada", tags: ["a", "b"] } },
    });
  });

  it("reports a multi-select outside its minItems / maxItems (#2904)", () => {
    const bounded: Schema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: {
            anyOf: [
              { const: "a", title: "A" },
              { const: "b", title: "B" },
              { const: "c", title: "C" },
            ],
          },
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ["tags"],
    };
    expect(elicitationContentFromForm(bounded, { tags: ["a"] })).toEqual({
      invalid: ["tags: choose at least 2"],
    });
    expect(
      elicitationContentFromForm(bounded, { tags: ["a", "b", "c"] }),
    ).toEqual({ invalid: ["tags: choose at most 2"] });
    expect(elicitationContentFromForm(bounded, { tags: ["a", "c"] })).toEqual({
      result: { action: "accept", content: { tags: ["a", "c"] } },
    });
  });

  it("accepts with the filled fields, wrapping a bare multi-select string", () => {
    expect(
      elicitationContentFromForm(schema, {
        name: "Ada",
        age: 36,
        tags: "a",
        ok: false,
        note: undefined,
      }),
    ).toEqual({
      result: {
        action: "accept",
        content: { name: "Ada", age: 36, tags: ["a"], ok: false },
      },
    });
  });

  it("keeps an answer to a field named __proto__", () => {
    const protoSchema = {
      type: "object",
      properties: JSON.parse('{"__proto__": {"type": "string"}}'),
      required: ["__proto__"],
    } as Schema;
    const outcome = elicitationContentFromForm(
      protoSchema,
      JSON.parse('{"__proto__": "x"}'),
    );
    expect("result" in outcome).toBe(true);
    const content = (outcome as { result: { content: object } }).result.content;
    expect(Object.hasOwn(content, "__proto__")).toBe(true);
    expect(JSON.stringify(content)).toBe('{"__proto__":"x"}');
  });

  it("drops null values", () => {
    expect(
      elicitationContentFromForm(schema, { name: "A", note: null }),
    ).toEqual({ result: { action: "accept", content: { name: "A" } } });
  });

  it("reports missing required fields", () => {
    expect(elicitationContentFromForm(schema, {})).toEqual({
      missing: ["name"],
    });
  });
});

describe("elicitationUrlRefusal", () => {
  it("allows http and https", () => {
    expect(elicitationUrlRefusal("https://example.com/x")).toBeUndefined();
    expect(elicitationUrlRefusal("http://localhost:3000")).toBeUndefined();
  });

  it("refuses other schemes and unparseable URLs", () => {
    expect(elicitationUrlRefusal("file:///etc/passwd")).toMatch(/Refusing/);
    expect(elicitationUrlRefusal("not a url")).toMatch(/Refusing/);
  });
});

describe("messageBoxHeight", () => {
  it("fits a short message", () => {
    expect(messageBoxHeight("Who are you?", 80, 40)).toBe(1);
    expect(messageBoxHeight("a\n\nb", 80, 40)).toBe(3);
  });

  it("counts wrapped rows", () => {
    expect(messageBoxHeight("x".repeat(25), 10, 40)).toBe(3);
  });

  it("caps a long message at a third of the terminal", () => {
    expect(messageBoxHeight(Array(30).fill("line").join("\n"), 80, 24)).toBe(8);
  });

  it("never returns less than one row", () => {
    expect(messageBoxHeight("", 0, 2)).toBe(1);
  });
});
