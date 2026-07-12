import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliFailure, expectCliSuccess } from "./helpers/assertions.js";
import { normalizeServerUrl, deepLinkTransport } from "../src/cli.js";
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

describe("deepLinkTransport", () => {
  it("honors an explicit sse/http transport over the URL path", () => {
    expect(deepLinkTransport("https://x.example/mcp", "sse")).toBe("sse");
    expect(deepLinkTransport("https://x.example/sse", "http")).toBe("http");
  });

  it("auto-detects sse from a /sse path when no transport is given", () => {
    expect(deepLinkTransport("https://x.example/sse", undefined)).toBe("sse");
  });

  it("defaults to http for a /mcp path, an ambiguous path, or stdio", () => {
    expect(deepLinkTransport("https://x.example/mcp", undefined)).toBe("http");
    expect(deepLinkTransport("https://x.example/", undefined)).toBe("http");
    expect(deepLinkTransport("https://x.example/mcp", "stdio")).toBe("http");
  });

  it("defaults to http for an unparseable URL without throwing", () => {
    expect(deepLinkTransport("not a url", undefined)).toBe("http");
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
    // Canonical #1576 deep-link: a `/mcp` server hands off `transport=http`.
    expect(out.deepLink).toContain("transport=http");
    expect(out.portForwardCmd).toContain("--tcp 16274:16274");
    expect(out.portForwardCmd).toContain("--tcp 16275:16275");
    expect(out.oauthStatePath).toBe(
      join("/tmp/inspector-storage", "oauth.json"),
    );
    expect(out.apiToken).toBe("tok123");
  });

  it("derives transport=sse for an SSE server (auto-detected from the /sse path)", async () => {
    const result = await runCli(
      ["--print-handoff", "--server-url", "https://x.example/sse"],
      { env: { MCP_INSPECTOR_API_TOKEN: "tok123" } },
    );
    expectCliSuccess(result);
    const out = JSON.parse(result.stdout) as { deepLink: string };
    expect(out.deepLink).toContain("transport=sse");
    expect(out.deepLink).not.toContain("transport=http");
  });

  it("honors an explicit --transport sse over the URL path", async () => {
    const result = await runCli(
      [
        "--print-handoff",
        "--server-url",
        "https://x.example/mcp",
        "--transport",
        "sse",
      ],
      { env: { MCP_INSPECTOR_API_TOKEN: "tok123" } },
    );
    expectCliSuccess(result);
    const out = JSON.parse(result.stdout) as { deepLink: string };
    expect(out.deepLink).toContain("transport=sse");
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
