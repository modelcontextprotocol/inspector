import { describe, it, expect } from "vitest";
import {
  getServerSpecificKey,
  OAUTH_STORAGE_KEYS,
} from "@inspector/core/auth/storage.js";

describe("OAuthStorage utilities", () => {
  describe("getServerSpecificKey", () => {
    it("prepends server URL in brackets to the base key", () => {
      expect(getServerSpecificKey("mcp_tokens", "https://example.com")).toBe(
        "[https://example.com] mcp_tokens",
      );
    });

    it("handles different server URLs independently", () => {
      const a = getServerSpecificKey("mcp_scope", "https://a.example");
      const b = getServerSpecificKey("mcp_scope", "https://b.example");
      expect(a).not.toBe(b);
    });
  });

  describe("OAUTH_STORAGE_KEYS", () => {
    it("exposes the canonical sessionStorage keys", () => {
      expect(OAUTH_STORAGE_KEYS).toEqual({
        CODE_VERIFIER: "mcp_code_verifier",
        TOKENS: "mcp_tokens",
        CLIENT_INFORMATION: "mcp_client_information",
        PREREGISTERED_CLIENT_INFORMATION:
          "mcp_preregistered_client_information",
        SERVER_METADATA: "mcp_server_metadata",
        SCOPE: "mcp_scope",
      });
    });
  });
});
