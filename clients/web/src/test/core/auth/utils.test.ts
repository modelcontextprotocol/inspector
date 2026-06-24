import { describe, it, expect } from "vitest";
import {
  parseHttpUrl,
  parseOAuthCallbackParams,
  generateOAuthState,
  generateOAuthStateWithExecution,
  generateOAuthStateWithMode,
  parseOAuthState,
  generateOAuthErrorDescription,
} from "@inspector/core/auth/utils.js";

describe("auth utils", () => {
  describe("parseOAuthCallbackParams", () => {
    it("should parse successful callback with code", () => {
      const params = parseOAuthCallbackParams("?code=abc123");
      expect(params).toEqual({ successful: true, code: "abc123" });
    });

    it("should parse error callback", () => {
      const params = parseOAuthCallbackParams(
        "?error=access_denied&error_description=User%20denied",
      );
      expect(params).toEqual({
        successful: false,
        error: "access_denied",
        error_description: "User denied",
        error_uri: null,
      });
    });

    it("should return invalid_request when code and error are missing", () => {
      const params = parseOAuthCallbackParams("?foo=bar");
      expect(params).toEqual({
        successful: false,
        error: "invalid_request",
        error_description: "Missing code or error in response",
        error_uri: null,
      });
    });
  });

  describe("generateOAuthState", () => {
    it("should generate 64-char hex string", () => {
      const state = generateOAuthState();
      expect(state).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should generate unique states", () => {
      const s1 = generateOAuthState();
      const s2 = generateOAuthState();
      expect(s1).not.toBe(s2);
    });
  });

  describe("generateOAuthStateWithExecution", () => {
    it("should generate state with quick prefix", () => {
      const state = generateOAuthStateWithExecution("quick");
      expect(state.startsWith("quick:")).toBe(true);
      expect(state.slice(6)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should generate state with guided prefix", () => {
      const state = generateOAuthStateWithExecution("guided");
      expect(state.startsWith("guided:")).toBe(true);
      expect(state.slice(7)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should generate unique states", () => {
      const s1 = generateOAuthStateWithExecution("quick");
      const s2 = generateOAuthStateWithExecution("quick");
      expect(s1).not.toBe(s2);
    });

    it("generateOAuthStateWithMode alias matches quick execution", () => {
      const state = generateOAuthStateWithMode("quick");
      expect(state.startsWith("quick:")).toBe(true);
    });
  });

  describe("parseOAuthState", () => {
    it("should parse quick prefix", () => {
      const parsed = parseOAuthState("quick:abc123def456");
      expect(parsed).toEqual({ execution: "quick", authId: "abc123def456" });
    });

    it("should parse guided prefix", () => {
      const parsed = parseOAuthState("guided:a1b2c3d4e5f6");
      expect(parsed).toEqual({ execution: "guided", authId: "a1b2c3d4e5f6" });
    });

    it("should map legacy normal prefix to quick", () => {
      const parsed = parseOAuthState("normal:abc123def456");
      expect(parsed).toEqual({ execution: "quick", authId: "abc123def456" });
    });

    it("should map legacy ema-idp prefix to quick", () => {
      const parsed = parseOAuthState("ema-idp:abc123def456");
      expect(parsed).toEqual({ execution: "quick", authId: "abc123def456" });
    });

    it("should parse legacy 64-char hex as quick", () => {
      const hex = "a".repeat(64);
      const parsed = parseOAuthState(hex);
      expect(parsed).toEqual({ execution: "quick", authId: hex });
    });

    it("should return null for invalid state", () => {
      expect(parseOAuthState("")).toBeNull();
      expect(parseOAuthState("invalid")).toBeNull();
      expect(parseOAuthState("other:xyz")).toBeNull();
    });
  });

  describe("generateOAuthErrorDescription", () => {
    it("should generate error description with error code only", () => {
      const params = {
        successful: false as const,
        error: "access_denied",
        error_description: null,
        error_uri: null,
      };

      const description = generateOAuthErrorDescription(params);

      expect(description).toBe("Error: access_denied.");
    });

    it("should generate error description with error code and description", () => {
      const params = {
        successful: false as const,
        error: "invalid_request",
        error_description: "The request is missing a required parameter",
        error_uri: null,
      };

      const description = generateOAuthErrorDescription(params);

      expect(description).toContain("Error: invalid_request.");
      expect(description).toContain(
        "Details: The request is missing a required parameter.",
      );
    });

    it("should generate error description with all fields", () => {
      const params = {
        successful: false as const,
        error: "server_error",
        error_description: "An internal server error occurred",
        error_uri: "https://example.com/errors/server_error",
      };

      const description = generateOAuthErrorDescription(params);

      expect(description).toContain("Error: server_error.");
      expect(description).toContain(
        "Details: An internal server error occurred.",
      );
      expect(description).toContain(
        "More info: https://example.com/errors/server_error.",
      );
    });

    it("should handle null error_description", () => {
      const params = {
        successful: false as const,
        error: "access_denied",
        error_description: null,
        error_uri: "https://example.com/error",
      };

      const description = generateOAuthErrorDescription(params);

      expect(description).toContain("Error: access_denied.");
      expect(description).not.toContain("Details:");
      expect(description).toContain("More info: https://example.com/error.");
    });

    it("should handle null error_uri", () => {
      const params = {
        successful: false as const,
        error: "invalid_client",
        error_description: "Invalid client credentials",
        error_uri: null,
      };

      const description = generateOAuthErrorDescription(params);

      expect(description).toContain("Error: invalid_client.");
      expect(description).toContain("Details: Invalid client credentials.");
      expect(description).not.toContain("More info:");
    });
  });

  describe("parseHttpUrl", () => {
    it("parses a valid absolute URL", () => {
      expect(parseHttpUrl("https://idp.example.com", "test").href).toBe(
        "https://idp.example.com/",
      );
    });

    it("throws with label and value when URL is invalid", () => {
      expect(() =>
        parseHttpUrl("https;//idp.xaa.dev", "EMA IdP issuer (Client Settings)"),
      ).toThrow(
        'Invalid EMA IdP issuer (Client Settings): "https;//idp.xaa.dev"',
      );
    });
  });
});
