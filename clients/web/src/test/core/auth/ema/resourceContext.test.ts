import { describe, it, expect, vi } from "vitest";
import {
  resolveEmaScopes,
  discoverEmaResourceContext,
  discoverResourceAsMetadata,
} from "@inspector/core/auth/ema/resourceContext.js";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/client";
import { minimalOAuthAsMetadata } from "../../../integration/mcp/ema-mock-servers.js";

const SERVER_URL = "http://127.0.0.1:9999/mcp";
const MCP_RESOURCE = "http://127.0.0.1:9999/mcp";
const AS_ISSUER = "https://as.resourcectx.test";

function resourceMetadata(
  overrides: Partial<OAuthProtectedResourceMetadata> = {},
): OAuthProtectedResourceMetadata {
  return {
    resource: MCP_RESOURCE,
    authorization_servers: [AS_ISSUER],
    scopes_supported: ["mcp", "profile"],
    ...overrides,
  } as OAuthProtectedResourceMetadata;
}

describe("ema resourceContext", () => {
  describe("resolveEmaScopes", () => {
    it("prefers a trimmed configured scope over metadata", () => {
      expect(resolveEmaScopes(resourceMetadata(), "  custom scope  ")).toBe(
        "custom scope",
      );
    });

    it("falls back to space-joined scopes_supported", () => {
      expect(resolveEmaScopes(resourceMetadata())).toBe("mcp profile");
    });

    it("treats a blank configured scope as unset", () => {
      expect(resolveEmaScopes(resourceMetadata(), "   ")).toBe("mcp profile");
    });

    it("returns undefined when neither configured nor supported scopes exist", () => {
      expect(
        resolveEmaScopes(resourceMetadata({ scopes_supported: [] })),
      ).toBeUndefined();
      expect(resolveEmaScopes(null)).toBeUndefined();
      expect(resolveEmaScopes(undefined)).toBeUndefined();
    });
  });

  describe("discoverEmaResourceContext", () => {
    it("discovers metadata, AS URL, resource URL, and scopes", async () => {
      const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/.well-known/oauth-protected-resource")) {
          return new Response(JSON.stringify(resourceMetadata()));
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const ctx = await discoverEmaResourceContext(
        SERVER_URL,
        undefined,
        fetchFn,
      );

      expect(ctx.resourceMetadata.resource).toBe(MCP_RESOURCE);
      expect(ctx.resourceAsUrl.href).toBe(`${AS_ISSUER}/`);
      expect(ctx.resourceUrl?.href).toBe(`${MCP_RESOURCE}`);
      expect(ctx.scope).toBe("mcp profile");
    });

    it("honors a configured scope override", async () => {
      const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/.well-known/oauth-protected-resource")) {
          return new Response(JSON.stringify(resourceMetadata()));
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const ctx = await discoverEmaResourceContext(SERVER_URL, "only", fetchFn);
      expect(ctx.scope).toBe("only");
    });

    it("rejects when protected resource metadata has no resource identifier", async () => {
      // NOTE: The SDK's discoverOAuthProtectedResourceMetadata validates the
      // response against a Zod schema that *requires* `resource`, so a response
      // lacking it is rejected at discovery time (Zod "invalid_type" on the
      // `resource` path) before reaching the explicit guard in
      // discoverEmaResourceContext. That guard is therefore a defensive,
      // schema-unreachable branch; we assert the observable behavior (rejection)
      // here rather than the guard's message.
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/.well-known/oauth-protected-resource")) {
          return new Response(
            JSON.stringify({ authorization_servers: [AS_ISSUER] }),
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      await expect(
        discoverEmaResourceContext(SERVER_URL, undefined, fetchFn),
      ).rejects.toThrow();
      errorSpy.mockRestore();
    });
  });

  describe("discoverResourceAsMetadata", () => {
    it("returns discovered authorization server metadata", async () => {
      const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/.well-known/oauth-authorization-server")) {
          return new Response(
            JSON.stringify(minimalOAuthAsMetadata(AS_ISSUER)),
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

      const metadata = await discoverResourceAsMetadata(
        new URL(AS_ISSUER),
        fetchFn,
      );
      expect(metadata.token_endpoint).toBe(`${AS_ISSUER}/token`);
    });

    it("throws when AS metadata discovery returns nothing", async () => {
      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      // All discovery endpoints 404 → SDK returns undefined.
      const fetchFn = vi.fn(
        async () => new Response("not found", { status: 404 }),
      );

      await expect(
        discoverResourceAsMetadata(new URL(AS_ISSUER), fetchFn),
      ).rejects.toThrow(/Failed to discover resource authorization server/);
      errorSpy.mockRestore();
    });
  });
});
