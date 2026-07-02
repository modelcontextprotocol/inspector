import { describe, it, expect } from "vitest";
import {
  computeScopeUnion,
  isStrictScopeSuperset,
} from "@inspector/core/auth/scopes.js";

describe("scopes", () => {
  describe("computeScopeUnion", () => {
    it("unions and dedupes scope tokens", () => {
      expect(
        computeScopeUnion("mcp tools:read", "tools:read weather:read"),
      ).toBe("mcp tools:read weather:read");
    });

    it("returns undefined when all inputs are empty", () => {
      expect(computeScopeUnion(undefined, "", undefined)).toBeUndefined();
    });
  });

  describe("isStrictScopeSuperset", () => {
    it("returns true when union adds a new scope", () => {
      expect(
        isStrictScopeSuperset("mcp tools:read weather:read", "mcp tools:read"),
      ).toBe(true);
    });

    it("returns false when union is covered by current grant", () => {
      expect(isStrictScopeSuperset("mcp tools:read", "mcp tools:read")).toBe(
        false,
      );
    });

    it("treats missing token scope as empty (forces re-auth)", () => {
      expect(isStrictScopeSuperset("mcp weather:read", undefined)).toBe(true);
    });
  });
});
