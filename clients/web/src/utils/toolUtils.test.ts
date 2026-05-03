import { describe, it, expect } from "vitest";
import { resolveDisplayLabel } from "./toolUtils";

describe("resolveDisplayLabel", () => {
  it("returns the title when provided", () => {
    expect(resolveDisplayLabel("send_message", "Send Message")).toBe(
      "Send Message",
    );
  });

  it("falls back to the name when title is undefined", () => {
    expect(resolveDisplayLabel("send_message")).toBe("send_message");
  });

  it("falls back to the name when title is an empty string is preserved", () => {
    // Empty string is a valid (if unusual) title — title ?? name only falls
    // back on undefined / null, not empty string. Document that here.
    expect(resolveDisplayLabel("send_message", "")).toBe("");
  });
});
