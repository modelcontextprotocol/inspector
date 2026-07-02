import { describe, it, expect, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  loadConfig,
  resolveConfig,
  ExternalAccessTokenValidator,
  extractScopesFromJwtPayload,
  TestServerHttp,
  createExternalResourceOAuthTestServerConfig,
} from "@modelcontextprotocol/inspector-test-server";

const repoRoot = path.resolve(import.meta.dirname, "../../../../../..");
const xaaConfigPath = path.join(
  repoRoot,
  "test-servers/configs/xaa-ema-http.json",
);

describe("protected-resource OAuth config", () => {
  it("loads xaa-ema-http.json and resolves oauth fields", () => {
    const config = loadConfig(xaaConfigPath);
    const serverConfig = resolveConfig(config);

    expect(serverConfig.oauth).toMatchObject({
      enabled: true,
      mode: "protected-resource",
      authorizationServers: ["https://auth.resource.xaa.dev"],
      requireAuth: true,
      accessTokenIssuers: ["https://auth.resource.xaa.dev"],
      jwksUri: "https://auth.resource.xaa.dev/jwks",
      resource: "http://localhost:8080/",
      resourceAudience: "http://localhost:8080/",
    });
    expect(serverConfig.serverType).toBe("streamable-http");
  });

  it("rejects protected-resource config without authorizationServers", () => {
    const invalidPath = path.join(
      os.tmpdir(),
      `invalid-oauth-${process.pid}.json`,
    );
    fs.writeFileSync(
      invalidPath,
      JSON.stringify({
        serverInfo: { name: "bad", version: "1.0.0" },
        transport: { type: "streamable-http" },
        oauth: { enabled: true, mode: "protected-resource" },
      }),
    );
    try {
      expect(() => loadConfig(invalidPath)).toThrow(
        /authorizationServers is required/,
      );
    } finally {
      fs.unlinkSync(invalidPath);
    }
  });
});

describe("ExternalAccessTokenValidator", () => {
  it("extracts scopes from JWT payload claims", () => {
    expect(extractScopesFromJwtPayload({ scope: "mcp tools:read" })).toEqual([
      "mcp",
      "tools:read",
    ]);
    expect(
      extractScopesFromJwtPayload({ scp: ["tools:read", "env:read"] }),
    ).toEqual(["tools:read", "env:read"]);
    expect(extractScopesFromJwtPayload({ scopes: ["tools:read"] })).toEqual([
      "tools:read",
    ]);
  });

  it("accepts JWTs signed by the AS and rejects wrong issuer", async () => {
    const issuer = "https://as.example";
    const jwksUri = "https://as.example/jwks";
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === jwksUri) {
        return new Response(
          JSON.stringify({
            keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const validator = new ExternalAccessTokenValidator(
      {
        authorizationServers: [issuer],
        jwksUri,
      },
      mockFetch as typeof fetch,
    );

    const validToken = await new SignJWT({ scope: "mcp" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(issuer)
      .setExpirationTime("1h")
      .sign(privateKey);

    const wrongIssuerToken = await new SignJWT({ scope: "mcp" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer("https://evil.example")
      .setExpirationTime("1h")
      .sign(privateKey);

    expect(await validator.validateAccessToken(validToken)).toBe(true);
    expect(await validator.validateAccessToken(wrongIssuerToken)).toBe(false);
    expect(await validator.validateAccessToken("not-a-jwt")).toBe(false);
  });
});

describe("TestServerHttp protected-resource metadata", () => {
  it("advertises external authorization_servers and skips local token endpoint", async () => {
    const server = new TestServerHttp({
      serverInfo: { name: "ema-rs", version: "1.0.0" },
      serverType: "streamable-http",
      ...createExternalResourceOAuthTestServerConfig({
        authorizationServers: ["https://xaa.dev"],
        requireAuth: false,
      }),
    });

    const port = await server.start();
    try {
      const base = `http://127.0.0.1:${port}`;
      const prRes = await fetch(`${base}/.well-known/oauth-protected-resource`);
      expect(prRes.ok).toBe(true);
      const pr = (await prRes.json()) as {
        authorization_servers: string[];
      };
      expect(pr.authorization_servers).toEqual(["https://xaa.dev"]);

      const asRes = await fetch(
        `${base}/.well-known/oauth-authorization-server`,
      );
      expect(asRes.status).toBe(404);

      const tokenRes = await fetch(`${base}/oauth/token`, { method: "POST" });
      expect(tokenRes.status).toBe(404);
    } finally {
      await server.stop();
    }
  });
});
