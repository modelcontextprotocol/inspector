import { describe, it, expect } from "vitest";
import { parseOAuthCallbackParams, generateOAuthState, generateOAuthStateWithMode, parseOAuthState, generateOAuthErrorDescription, } from "../../auth/utils.js";
describe("OAuth Utils", () => {
    describe("parseOAuthCallbackParams", () => {
        it("should parse successful callback with code", () => {
            const location = "?code=abc123&state=xyz789";
            const result = parseOAuthCallbackParams(location);
            expect(result.successful).toBe(true);
            if (result.successful) {
                expect(result.code).toBe("abc123");
            }
        });
        it("should parse error callback", () => {
            const location = "?error=access_denied&error_description=User%20denied%20access";
            const result = parseOAuthCallbackParams(location);
            expect(result.successful).toBe(false);
            if (!result.successful) {
                expect(result.error).toBe("access_denied");
                expect(result.error_description).toBe("User denied access");
            }
        });
        it("should parse error callback with error_uri", () => {
            const location = "?error=invalid_request&error_description=Invalid%20request&error_uri=https://example.com/error";
            const result = parseOAuthCallbackParams(location);
            expect(result.successful).toBe(false);
            if (!result.successful) {
                expect(result.error).toBe("invalid_request");
                expect(result.error_description).toBe("Invalid request");
                expect(result.error_uri).toBe("https://example.com/error");
            }
        });
        it("should return invalid_request when neither code nor error is present", () => {
            const location = "?state=xyz789";
            const result = parseOAuthCallbackParams(location);
            expect(result.successful).toBe(false);
            if (!result.successful) {
                expect(result.error).toBe("invalid_request");
                expect(result.error_description).toBe("Missing code or error in response");
            }
        });
        it("should handle empty query string", () => {
            const location = "";
            const result = parseOAuthCallbackParams(location);
            expect(result.successful).toBe(false);
            if (!result.successful) {
                expect(result.error).toBe("invalid_request");
            }
        });
        it("should handle URL-encoded values", () => {
            const location = "?code=abc%20123&error_description=Test%20%26%20More";
            const result = parseOAuthCallbackParams(location);
            expect(result.successful).toBe(true);
            if (result.successful) {
                expect(result.code).toBe("abc 123");
            }
        });
    });
    describe("generateOAuthState", () => {
        it("should generate a random state string", () => {
            const state1 = generateOAuthState();
            const state2 = generateOAuthState();
            expect(typeof state1).toBe("string");
            expect(state1.length).toBeGreaterThan(0);
            expect(state1).not.toBe(state2); // Should be different each time
        });
        it("should generate state with consistent length", () => {
            const states = Array.from({ length: 10 }, () => generateOAuthState());
            const lengths = states.map((s) => s.length);
            const uniqueLengths = new Set(lengths);
            // All states should have the same length (64 hex characters for 32 bytes)
            expect(uniqueLengths.size).toBe(1);
            expect(lengths[0]).toBe(64);
        });
        it("should generate valid hex string", () => {
            const state = generateOAuthState();
            const hexPattern = /^[0-9a-f]+$/;
            expect(hexPattern.test(state)).toBe(true);
        });
    });
    describe("generateOAuthStateWithMode", () => {
        it("should generate state with normal prefix", () => {
            const state = generateOAuthStateWithMode("normal");
            expect(state.startsWith("normal:")).toBe(true);
            expect(state.slice(7)).toMatch(/^[0-9a-f]{64}$/);
        });
        it("should generate state with guided prefix", () => {
            const state = generateOAuthStateWithMode("guided");
            expect(state.startsWith("guided:")).toBe(true);
            expect(state.slice(7)).toMatch(/^[0-9a-f]{64}$/);
        });
        it("should generate unique states", () => {
            const s1 = generateOAuthStateWithMode("normal");
            const s2 = generateOAuthStateWithMode("normal");
            expect(s1).not.toBe(s2);
        });
    });
    describe("parseOAuthState", () => {
        it("should parse normal prefix", () => {
            const parsed = parseOAuthState("normal:abc123def456");
            expect(parsed).toEqual({ mode: "normal", authId: "abc123def456" });
        });
        it("should parse guided prefix", () => {
            const parsed = parseOAuthState("guided:a1b2c3d4e5f6");
            expect(parsed).toEqual({ mode: "guided", authId: "a1b2c3d4e5f6" });
        });
        it("should parse legacy 64-char hex as normal", () => {
            const hex = "a".repeat(64);
            const parsed = parseOAuthState(hex);
            expect(parsed).toEqual({ mode: "normal", authId: hex });
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
                successful: false,
                error: "access_denied",
                error_description: null,
                error_uri: null,
            };
            const description = generateOAuthErrorDescription(params);
            expect(description).toBe("Error: access_denied.");
        });
        it("should generate error description with error code and description", () => {
            const params = {
                successful: false,
                error: "invalid_request",
                error_description: "The request is missing a required parameter",
                error_uri: null,
            };
            const description = generateOAuthErrorDescription(params);
            expect(description).toContain("Error: invalid_request.");
            expect(description).toContain("Details: The request is missing a required parameter.");
        });
        it("should generate error description with all fields", () => {
            const params = {
                successful: false,
                error: "server_error",
                error_description: "An internal server error occurred",
                error_uri: "https://example.com/errors/server_error",
            };
            const description = generateOAuthErrorDescription(params);
            expect(description).toContain("Error: server_error.");
            expect(description).toContain("Details: An internal server error occurred.");
            expect(description).toContain("More info: https://example.com/errors/server_error.");
        });
        it("should handle null error_description", () => {
            const params = {
                successful: false,
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
                successful: false,
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
});
//# sourceMappingURL=utils.test.js.map