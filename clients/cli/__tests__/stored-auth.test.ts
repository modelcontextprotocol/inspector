import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliFailure, expectCliSuccess } from "./helpers/assertions.js";
import { normalizeServerUrl, refreshStoredAuthToken } from "../src/cli.js";
import {
  createTestServerHttp,
  createEchoTool,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * Writes an oauth.json fixture in the plain `{ servers, idpSessions }` layout
 * the web backend persists (also accepted: the legacy `{ state, version }`
 * envelope). The CLI reads it through the shared `parseOAuthPersistBlob`, so
 * both sides agree on the format and the URL-normalised server key.
 */
function writeOAuthFixture(servers: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "inspector-cli-stored-auth-"));
  const file = join(dir, "oauth.json");
  writeFileSync(file, JSON.stringify({ servers, idpSessions: {} }), "utf8");
  return file;
}

describe("normalizeServerUrl", () => {
  it("canonicalises a URL via new URL().href (lowercases scheme/host)", () => {
    expect(normalizeServerUrl("HTTP://Example.COM/Mcp")).toBe(
      "http://example.com/Mcp",
    );
  });

  it("returns the raw string when the value is not a parseable URL", () => {
    expect(normalizeServerUrl("not a url")).toBe("not a url");
  });
});

describe("refreshStoredAuthToken", () => {
  const SERVER = "https://api.example/mcp";
  const freshTokens = {
    access_token: "refreshed-access-token",
    token_type: "Bearer",
    refresh_token: "rotated-refresh-token",
    expires_in: 3600,
  };

  it("runs the refresh grant, injects the fresh token, and persists the rotation", async () => {
    const path = writeOAuthFixture({
      [SERVER]: {
        tokens: { refresh_token: "old-refresh", token_type: "Bearer" },
        clientInformation: { client_id: "cid", client_secret: "sec" },
        serverMetadata: {
          issuer: "https://auth.example",
          token_endpoint: "https://auth.example/token",
        },
      },
    });
    try {
      const refresh = vi.fn().mockResolvedValue(freshTokens);
      const discover = vi.fn();
      const token = await refreshStoredAuthToken(SERVER, path, {
        refresh,
        discover,
      });
      expect(token).toBe("refreshed-access-token");
      // Stored metadata present → no discovery needed.
      expect(discover).not.toHaveBeenCalled();
      // Refresh called with the stored refresh token + client information.
      expect(refresh).toHaveBeenCalledTimes(1);
      const [, opts] = refresh.mock.calls[0]!;
      expect(opts.refreshToken).toBe("old-refresh");
      expect(opts.clientInformation).toEqual({
        client_id: "cid",
        client_secret: "sec",
      });
      // Rotation persisted back under the same key.
      const persisted = JSON.parse(readFileSync(path, "utf8")) as {
        servers: Record<string, { tokens?: { refresh_token?: string } }>;
      };
      expect(persisted.servers[SERVER]?.tokens?.refresh_token).toBe(
        "rotated-refresh-token",
      );
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("discovers the auth-server metadata when it was not persisted", async () => {
    const path = writeOAuthFixture({
      [SERVER]: {
        tokens: { refresh_token: "old-refresh", token_type: "Bearer" },
        clientInformation: { client_id: "cid" },
      },
    });
    try {
      const refresh = vi.fn().mockResolvedValue(freshTokens);
      const discover = vi.fn().mockResolvedValue({
        issuer: "https://api.example",
        token_endpoint: "https://api.example/token",
      });
      const token = await refreshStoredAuthToken(SERVER, path, {
        refresh,
        discover,
      });
      expect(token).toBe("refreshed-access-token");
      expect(discover).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("passes metadata=undefined to the refresh grant when discovery returns nothing", async () => {
    const path = writeOAuthFixture({
      [SERVER]: {
        tokens: { refresh_token: "old-refresh", token_type: "Bearer" },
        clientInformation: { client_id: "cid" },
      },
    });
    try {
      const refresh = vi.fn().mockResolvedValue(freshTokens);
      const discover = vi.fn().mockResolvedValue(undefined);
      const token = await refreshStoredAuthToken(SERVER, path, {
        refresh,
        discover,
      });
      expect(token).toBe("refreshed-access-token");
      const [, opts] = refresh.mock.calls[0]!;
      expect(opts.metadata).toBeUndefined();
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("uses the distinct no_client_information code when client info is missing", async () => {
    const path = writeOAuthFixture({
      [SERVER]: {
        tokens: { refresh_token: "old-refresh", token_type: "Bearer" },
      },
    });
    try {
      await expect(
        refreshStoredAuthToken(SERVER, path, { refresh: vi.fn() }),
      ).rejects.toMatchObject({
        exitCode: 3,
        envelope: { code: "no_client_information" },
      });
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("throws AUTH_REQUIRED when no refresh token is stored", async () => {
    const path = writeOAuthFixture({
      [SERVER]: {
        tokens: { access_token: "only-access", token_type: "Bearer" },
      },
    });
    try {
      await expect(
        refreshStoredAuthToken(SERVER, path, { refresh: vi.fn() }),
      ).rejects.toMatchObject({ exitCode: 3 });
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("throws AUTH_REQUIRED when a refresh token is present but client information is missing", async () => {
    const path = writeOAuthFixture({
      [SERVER]: {
        tokens: { refresh_token: "old-refresh", token_type: "Bearer" },
      },
    });
    try {
      await expect(
        refreshStoredAuthToken(SERVER, path, { refresh: vi.fn() }),
      ).rejects.toMatchObject({ exitCode: 3 });
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("surfaces a refresh-grant failure as AUTH_REQUIRED (refresh_failed)", async () => {
    const path = writeOAuthFixture({
      [SERVER]: {
        tokens: { refresh_token: "old-refresh", token_type: "Bearer" },
        clientInformation: { client_id: "cid" },
        serverMetadata: {
          issuer: "https://auth.example",
          token_endpoint: "https://auth.example/token",
        },
      },
    });
    try {
      const refresh = vi
        .fn()
        .mockRejectedValue(new Error("invalid_grant: token revoked"));
      await expect(
        refreshStoredAuthToken(SERVER, path, { refresh }),
      ).rejects.toMatchObject({
        exitCode: 3,
        envelope: { code: "refresh_failed" },
      });
    } finally {
      rmSync(path, { force: true });
    }
  });
});

describe("--use-stored-auth", () => {
  let server: ReturnType<typeof createTestServerHttp>;
  let serverUrl: string;
  let fixturePath: string;
  const TOKEN = "stored-access-token-abc";

  beforeAll(async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });
    await server.start();
    serverUrl = server.url;
    fixturePath = writeOAuthFixture({
      [serverUrl]: { tokens: { access_token: TOKEN, token_type: "Bearer" } },
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(fixturePath, { force: true });
  });

  it("injects the stored token as Authorization: Bearer on the outgoing request", async () => {
    const result = await runCli(
      [
        "--transport",
        "http",
        "--server-url",
        serverUrl,
        "--use-stored-auth",
        "--method",
        "tools/list",
      ],
      { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: fixturePath } },
    );
    expectCliSuccess(result);
    const recorded = server.getRecordedRequests();
    expect(recorded.length).toBeGreaterThan(0);
    const last = recorded[recorded.length - 1]!;
    expect(last.headers?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("merges with --header (explicit headers + stored auth coexist)", async () => {
    const result = await runCli(
      [
        "--transport",
        "http",
        "--server-url",
        serverUrl,
        "--use-stored-auth",
        "--header",
        "X-Trace: abc",
        "--method",
        "tools/list",
      ],
      { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: fixturePath } },
    );
    expectCliSuccess(result);
    const last = server.getRecordedRequests().at(-1)!;
    expect(last.headers?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(last.headers?.["x-trace"]).toBe("abc");
  });

  it("errors clearly when --server-url is missing", async () => {
    const result = await runCli(
      ["--use-stored-auth", "--method", "tools/list"],
      { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: fixturePath } },
    );
    expectCliFailure(result);
    expect(result.stderr).toContain("--use-stored-auth requires --server-url");
  });

  it("errors clearly when --wait-for-auth is set without --server-url", async () => {
    // Exercises the `--wait-for-auth` arm of the shared missing-server-url
    // guard's message ternary (the --use-stored-auth arm is covered above).
    const result = await runCli(
      ["--wait-for-auth", "5", "--method", "tools/list"],
      { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: fixturePath } },
    );
    expectCliFailure(result);
    expect(result.stderr).toContain("--wait-for-auth requires --server-url");
  });

  it("errors with exit 3 (AUTH_REQUIRED) and lists stored keys when no token matches", async () => {
    const other = writeOAuthFixture({
      "https://other.example/mcp": {
        tokens: { access_token: "x", token_type: "Bearer" },
      },
    });
    try {
      const result = await runCli(
        [
          "--transport",
          "http",
          "--server-url",
          serverUrl,
          "--use-stored-auth",
          "--method",
          "tools/list",
        ],
        { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: other } },
      );
      expect(result.exitCode).toBe(3);
      const env = JSON.parse(result.stderr.trim()) as {
        error: { code: string; message: string };
      };
      expect(env.error.code).toBe("no_stored_token");
      expect(env.error.message).toContain("No stored OAuth token");
      expect(env.error.message).toContain("https://other.example/mcp");
    } finally {
      rmSync(other, { force: true });
    }
  });

  it("matches a stored key even when --server-url differs by URL normalisation", async () => {
    // Store under the normalised form; pass the upper-cased scheme on the
    // command line. new URL().href lowercases the scheme, so the lookup still
    // resolves.
    const normalised = normalizeServerUrl(serverUrl);
    const upper = serverUrl.replace("http://", "HTTP://");
    const fixture = writeOAuthFixture({
      [normalised]: { tokens: { access_token: TOKEN, token_type: "Bearer" } },
    });
    try {
      const result = await runCli(
        [
          "--transport",
          "http",
          "--server-url",
          upper,
          "--use-stored-auth",
          "--method",
          "tools/list",
        ],
        { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: fixture } },
      );
      expectCliSuccess(result);
    } finally {
      rmSync(fixture, { force: true });
    }
  });

  it("honours MCP_STORAGE_DIR when MCP_INSPECTOR_OAUTH_STATE_PATH is unset", async () => {
    const dir = dirname(fixturePath);
    const result = await runCli(
      [
        "--transport",
        "http",
        "--server-url",
        serverUrl,
        "--use-stored-auth",
        "--method",
        "tools/list",
      ],
      { env: { MCP_STORAGE_DIR: dir } },
    );
    expectCliSuccess(result);
    const last = server.getRecordedRequests().at(-1)!;
    expect(last.headers?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("refreshes a stored refresh_token end-to-end and injects the fresh access token (#1665)", async () => {
    // Minimal OAuth token endpoint: honors the refresh_token grant with a
    // rotated token pair, so the CLI's real SDK refresh path has something to
    // talk to (the MCP test server accepts any bearer, so a successful connect
    // proves the refreshed token was injected).
    let tokenRequests = 0;
    const tokenServer: Server = createServer((req, res) => {
      tokenRequests += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "refreshed-access-token",
          token_type: "Bearer",
          refresh_token: "rotated-refresh-token",
          expires_in: 3600,
        }),
      );
    });
    await new Promise<void>((resolve) => tokenServer.listen(0, resolve));
    const addr = tokenServer.address();
    const tokenBase =
      typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
    const fixture = writeOAuthFixture({
      [serverUrl]: {
        tokens: { refresh_token: "old-refresh", token_type: "Bearer" },
        clientInformation: { client_id: "cid", client_secret: "sec" },
        serverMetadata: {
          issuer: tokenBase,
          token_endpoint: `${tokenBase}/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        },
      },
    });
    try {
      const result = await runCli(
        [
          "--transport",
          "http",
          "--server-url",
          serverUrl,
          "--use-stored-auth",
          "--method",
          "tools/list",
        ],
        { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: fixture } },
      );
      expectCliSuccess(result);
      expect(tokenRequests).toBeGreaterThan(0);
      const last = server.getRecordedRequests().at(-1)!;
      expect(last.headers?.authorization).toBe("Bearer refreshed-access-token");
      // Rotation persisted so a subsequent run reuses the new refresh token.
      const persisted = JSON.parse(readFileSync(fixture, "utf8")) as {
        servers: Record<string, { tokens?: { refresh_token?: string } }>;
      };
      expect(persisted.servers[serverUrl]?.tokens?.refresh_token).toBe(
        "rotated-refresh-token",
      );
    } finally {
      rmSync(fixture, { force: true });
      await new Promise<void>((resolve) => tokenServer.close(() => resolve()));
    }
  });

  it("falls back to the stored access token when the refresh grant fails (#1665 review #1)", async () => {
    // Token endpoint that rejects the refresh grant, so the CLI must fall back
    // to the still-present stored access token instead of hard-failing.
    const tokenServer: Server = createServer((_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_grant" }));
    });
    await new Promise<void>((resolve) => tokenServer.listen(0, resolve));
    const addr = tokenServer.address();
    const tokenBase =
      typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
    const fixture = writeOAuthFixture({
      [serverUrl]: {
        tokens: {
          access_token: "still-usable-access",
          refresh_token: "old-refresh",
          token_type: "Bearer",
        },
        clientInformation: { client_id: "cid", client_secret: "sec" },
        serverMetadata: {
          issuer: tokenBase,
          token_endpoint: `${tokenBase}/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        },
      },
    });
    try {
      const result = await runCli(
        [
          "--transport",
          "http",
          "--server-url",
          serverUrl,
          "--use-stored-auth",
          "--method",
          "tools/list",
        ],
        { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: fixture } },
      );
      expectCliSuccess(result);
      const last = server.getRecordedRequests().at(-1)!;
      expect(last.headers?.authorization).toBe("Bearer still-usable-access");
    } finally {
      rmSync(fixture, { force: true });
      await new Promise<void>((resolve) => tokenServer.close(() => resolve()));
    }
  });
});

describe("--list-stored-auth", () => {
  it("prints the stored server URLs and the resolved state path", async () => {
    const fixture = writeOAuthFixture({
      "https://a.example/mcp": {
        tokens: { access_token: "t1", token_type: "Bearer" },
      },
      "https://b.example/mcp": { tokens: {} },
    });
    try {
      const result = await runCli(["--list-stored-auth"], {
        env: { MCP_INSPECTOR_OAUTH_STATE_PATH: fixture },
      });
      expectCliSuccess(result);
      const out = JSON.parse(result.stdout) as {
        oauthStatePath: string;
        storedServerUrls: string[];
      };
      expect(out.oauthStatePath).toBe(fixture);
      expect(out.storedServerUrls).toEqual(["https://a.example/mcp"]);
    } finally {
      rmSync(fixture, { force: true });
    }
  });

  it("emits an empty list when the state file is absent", async () => {
    const result = await runCli(["--list-stored-auth"], {
      env: { MCP_INSPECTOR_OAUTH_STATE_PATH: "/no/such/file.json" },
    });
    expectCliSuccess(result);
    const out = JSON.parse(result.stdout) as { storedServerUrls: string[] };
    expect(out.storedServerUrls).toEqual([]);
  });
});

describe("--print-handoff", () => {
  it("emits a JSON handoff block with deepLink, port-forward command, and the resolved state path", async () => {
    const result = await runCli(
      ["--print-handoff", "--server-url", "https://x.example/mcp"],
      {
        env: {
          MCP_INSPECTOR_API_TOKEN: "tok123",
          CLIENT_PORT: "16274",
          MCP_SANDBOX_PORT: "16275",
          MCP_STORAGE_DIR: "/tmp/inspector-storage",
          MCP_INSPECTOR_OAUTH_STATE_PATH: "",
        },
      },
    );
    expectCliSuccess(result);
    const out = JSON.parse(result.stdout) as {
      serverUrl: string;
      deepLink: string;
      portForwardCmd: string;
      oauthStatePath: string;
      apiToken: string;
    };
    expect(out.serverUrl).toBe("https://x.example/mcp");
    expect(out.deepLink).toContain("autoConnect=tok123");
    expect(out.deepLink).toContain("serverUrl=https%3A%2F%2Fx.example%2Fmcp");
    expect(out.portForwardCmd).toContain("--tcp 16274:16274");
    expect(out.portForwardCmd).toContain("--tcp 16275:16275");
    expect(out.oauthStatePath).toBe(
      join("/tmp/inspector-storage", "oauth.json"),
    );
    expect(out.apiToken).toBe("tok123");
  });

  it("includes a note when MCP_INSPECTOR_API_TOKEN is unset", async () => {
    const result = await runCli(
      ["--print-handoff", "--server-url", "https://x.example/mcp"],
      { env: { MCP_INSPECTOR_API_TOKEN: "" } },
    );
    expectCliSuccess(result);
    const out = JSON.parse(result.stdout) as {
      apiToken: string | null;
      note?: string;
    };
    expect(out.apiToken).toBeNull();
    expect(out.note).toContain("MCP_INSPECTOR_API_TOKEN is not set");
  });

  it("requires --server-url", async () => {
    const result = await runCli(["--print-handoff"]);
    expectCliFailure(result);
    expect(result.stderr).toContain("--print-handoff requires --server-url");
  });
});

describe("--wait-for-auth", () => {
  let server: ReturnType<typeof createTestServerHttp>;
  let serverUrl: string;

  beforeAll(async () => {
    server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });
    await server.start();
    serverUrl = server.url;
  });

  afterAll(async () => {
    await server.stop();
  });

  it("polls until the token appears, then proceeds with it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inspector-cli-wait-"));
    const file = join(dir, "oauth.json");
    // Write the token after a short delay so the first poll misses.
    setTimeout(() => {
      writeFileSync(
        file,
        JSON.stringify({
          servers: {
            [normalizeServerUrl(serverUrl)]: {
              tokens: { access_token: "waited-tok", token_type: "Bearer" },
            },
          },
          idpSessions: {},
        }),
        "utf8",
      );
    }, 200);
    try {
      const result = await runCli(
        [
          "--transport",
          "http",
          "--server-url",
          serverUrl,
          "--wait-for-auth",
          "5",
          "--method",
          "tools/list",
        ],
        { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: file } },
      );
      expectCliSuccess(result);
      const last = server.getRecordedRequests().at(-1)!;
      expect(last.headers?.authorization).toBe("Bearer waited-tok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("times out with exit 3 (AUTH_REQUIRED) when no token appears", async () => {
    const result = await runCli(
      [
        "--transport",
        "http",
        "--server-url",
        serverUrl,
        "--wait-for-auth",
        "1",
        "--method",
        "tools/list",
      ],
      { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: "/no/such/file.json" } },
    );
    expect(result.exitCode).toBe(3);
    const env = JSON.parse(result.stderr.trim()) as {
      error: { code: string };
    };
    expect(env.error.code).toBe("auth_wait_timeout");
  });

  it("rejects a non-positive timeout", async () => {
    const result = await runCli([
      "--server-url",
      "https://x.example/mcp",
      "--wait-for-auth",
      "0",
      "--method",
      "tools/list",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toContain("positive number of seconds");
  });
});
