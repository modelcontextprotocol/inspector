import { describe, it, expect } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { hasInputFields, resolveDisplayLabel } from "./toolUtils";

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
