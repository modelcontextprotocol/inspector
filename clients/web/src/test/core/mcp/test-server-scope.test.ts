import { describe, it, expect, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  buildScopeRequirementRegistry,
  clearOAuthTestData,
  createScopeCheckMiddleware,
  mintTestAccessToken,
  scopeRequirementRegistryHasEntries,
} from "@modelcontextprotocol/inspector-test-server";
import type { ServerConfig } from "@modelcontextprotocol/inspector-test-server";

function createMinimalConfig(
  overrides: Partial<ServerConfig> = {},
): ServerConfig {
  return {
    serverInfo: { name: "scope-test", version: "1.0.0" },
    tools: [
      {
        name: "get_temp",
        description: "mock",
        requiredScopes: ["weather:read"],
        handler: async () => ({
          content: [{ type: "text" as const, text: "ok" }],
        }),
      },
    ],
    ...overrides,
  };
}

function invokeScopeMiddleware(
  registry: ReturnType<typeof buildScopeRequirementRegistry>,
  body: unknown,
  token: string,
  oauthTokenScopes?: string[],
): {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  next: boolean;
} {
  const middleware = createScopeCheckMiddleware(registry);
  const headers: Record<string, string> = {};
  let status = 200;
  let responseBody: unknown;
  let nextCalled = false;

  const req = {
    body,
    oauthToken: token,
    ...(oauthTokenScopes !== undefined ? { oauthTokenScopes } : {}),
  } as Request & { oauthToken: string; oauthTokenScopes?: string[] };

  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    json(payload: unknown) {
      responseBody = payload;
    },
  } as unknown as Response;

  middleware(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);

  return { status, headers, body: responseBody, next: nextCalled };
}

describe("test server scope requirements", () => {
  beforeEach(() => {
    clearOAuthTestData();
  });

  it("builds registry from capability requiredScopes", () => {
    const registry = buildScopeRequirementRegistry(createMinimalConfig());
    expect(scopeRequirementRegistryHasEntries(registry)).toBe(true);
    expect(registry.tools.get("get_temp")).toEqual(["weather:read"]);
  });

  it("returns 403 insufficient_scope when token lacks required scope", () => {
    const token = mintTestAccessToken("mcp tools:read");
    const registry = buildScopeRequirementRegistry(createMinimalConfig());
    const result = invokeScopeMiddleware(
      registry,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_temp", arguments: { city: "NYC", units: "C" } },
      },
      token,
    );

    expect(result.next).toBe(false);
    expect(result.status).toBe(403);
    expect(result.headers["www-authenticate"]).toContain("insufficient_scope");
    expect(result.headers["www-authenticate"]).toContain("weather:read");
    expect(result.headers["www-authenticate"]).not.toContain("tools:read");
  });

  it("allows request when token includes required scopes", () => {
    const token = mintTestAccessToken("mcp tools:read weather:read");
    const registry = buildScopeRequirementRegistry(createMinimalConfig());
    const result = invokeScopeMiddleware(
      registry,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_temp", arguments: { city: "NYC", units: "C" } },
      },
      token,
    );

    expect(result.next).toBe(true);
    expect(result.status).toBe(200);
  });

  it("enforces requiredScopes on resource templates for resources/read", () => {
    const registry = buildScopeRequirementRegistry({
      ...createMinimalConfig({ tools: [] }),
      resourceTemplates: [
        {
          name: "files",
          uriTemplate: "file:///{path}",
          requiredScopes: ["files:read"],
          handler: async () => ({
            contents: [{ uri: "file:///tmp/x", text: "ok" }],
          }),
        },
      ],
    });
    expect(registry.resourceTemplates.get("file:///{path}")).toEqual([
      "files:read",
    ]);

    const denied = invokeScopeMiddleware(
      registry,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "resources/read",
        params: { uri: "file:///tmp/example.txt" },
      },
      mintTestAccessToken("mcp"),
    );
    expect(denied.next).toBe(false);
    expect(denied.status).toBe(403);

    const allowed = invokeScopeMiddleware(
      registry,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "resources/read",
        params: { uri: "file:///tmp/example.txt" },
      },
      mintTestAccessToken("mcp files:read"),
    );
    expect(allowed.next).toBe(true);
  });

  it("uses oauthTokenScopes attached by bearer middleware (external JWT path)", () => {
    const registry = buildScopeRequirementRegistry({
      ...createMinimalConfig(),
      tools: [
        {
          name: "echo",
          description: "mock",
          requiredScopes: ["tools:read"],
          handler: async () => ({
            content: [{ type: "text" as const, text: "ok" }],
          }),
        },
      ],
    });
    const result = invokeScopeMiddleware(
      registry,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "hi" } },
      },
      "external.jwt.not.in.internal.map",
      ["tools:read"],
    );

    expect(result.next).toBe(true);
    expect(result.status).toBe(200);
  });
});
