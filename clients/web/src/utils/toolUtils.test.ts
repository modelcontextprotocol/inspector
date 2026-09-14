import { describe, it, expect } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";
import {
  findToolByRowKey,
  hasInputFields,
  resolveDisplayLabel,
  toolRowKey,
} from "./toolUtils";

describe("resolveDisplayLabel", () => {
  it("returns the title when provided", () => {
    expect(resolveDisplayLabel("send_message", "Send Message")).toBe(
      "Send Message",
    );
  });

  it("falls back to the name when title is undefined", () => {
    expect(resolveDisplayLabel("send_message")).toBe("send_message");
  });

  it("preserves an empty-string title rather than falling back to the name", () => {
    // Empty string is a valid (if unusual) title — title ?? name only falls
    // back on undefined / null, not empty string. Document that here.
    expect(resolveDisplayLabel("send_message", "")).toBe("");
  });
});

describe("hasInputFields", () => {
  const baseTool = (inputSchema: Tool["inputSchema"]): Tool => ({
    name: "t",
    inputSchema,
  });

  it("returns false when properties is missing", () => {
    expect(hasInputFields(baseTool({ type: "object" }))).toBe(false);
  });

  it("returns false when properties is empty", () => {
    expect(hasInputFields(baseTool({ type: "object", properties: {} }))).toBe(
      false,
    );
  });

  it("returns true when properties has at least one entry", () => {
    expect(
      hasInputFields(
        baseTool({
          type: "object",
          properties: { x: { type: "string" } },
        }),
      ),
    ).toBe(true);
  });
});

describe("toolRowKey / findToolByRowKey", () => {
  const tool = (name: string): Tool => ({
    name,
    inputSchema: { type: "object" },
  });
  // A `tools/list` may legitimately repeat a name (#1957/#2001).
  const tools: Tool[] = [
    tool("get_weather"),
    tool("echo"),
    tool("get_weather"),
  ];

  it("distinguishes two tools that share a name", () => {
    expect(toolRowKey("get_weather", 0)).not.toBe(toolRowKey("get_weather", 2));
  });

  it("resolves each duplicate to its own entry", () => {
    expect(findToolByRowKey(tools, "0:get_weather")).toBe(tools[0]);
    // The second copy — the one a name-based lookup could never reach.
    expect(findToolByRowKey(tools, "2:get_weather")).toBe(tools[2]);
  });

  it("returns undefined for no key", () => {
    expect(findToolByRowKey(tools, undefined)).toBeUndefined();
  });

  it("returns undefined for a key naming no current row", () => {
    // A stale selection after the list changed underneath it.
    expect(findToolByRowKey(tools, "9:gone")).toBeUndefined();
    // Right name, wrong position: still not a match.
    expect(findToolByRowKey(tools, "1:get_weather")).toBeUndefined();
  });
});

describe("hasInputFields with root composition (#2123)", () => {
  const tool = (inputSchema: Tool["inputSchema"]): Tool => ({
    name: "t",
    inputSchema,
  });

  it("sees fields declared on a root union branch", () => {
    expect(
      hasInputFields(
        tool({
          type: "object",
          anyOf: [
            { type: "object", properties: { a: { type: "string" } } },
            { type: "object", properties: { b: { type: "string" } } },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("sees fields declared on a root allOf", () => {
    expect(
      hasInputFields(
        tool({
          type: "object",
          allOf: [{ type: "object", properties: { a: { type: "string" } } }],
        }),
      ),
    ).toBe(true);
  });

  it("sees fields on a union the form declines to flatten", () => {
    // Otherwise an App tool with such a schema is treated as input-free and
    // invoked immediately with `{}`.
    expect(
      hasInputFields(
        tool({
          type: "object",
          anyOf: [
            { type: "object", properties: { a: { type: "string" } } },
            { $ref: "#/$defs/Other" },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("counts a $ref member, whose shape is unknown rather than empty", () => {
    expect(
      hasInputFields(
        tool({
          type: "object",
          anyOf: [{ $ref: "#/$defs/Email" }, { $ref: "#/$defs/Sms" }],
        }),
      ),
    ).toBe(true);
  });

  it("counts a required name the schema never declares", () => {
    expect(hasInputFields(tool({ type: "object", required: ["token"] }))).toBe(
      true,
    );
  });

  it("still reports no fields for a bare object schema", () => {
    expect(hasInputFields(tool({ type: "object" }))).toBe(false);
  });
});
