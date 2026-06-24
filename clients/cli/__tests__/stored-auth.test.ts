import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliFailure, expectCliSuccess } from "./helpers/assertions.js";
import { normalizeServerUrl } from "../src/cli.js";
import {
  createTestServerHttp,
  createEchoTool,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * Writes a Zustand-persist–shaped oauth.json fixture (the same blob the web
 * inspector's RemoteOAuthStorage POSTs to /api/storage/oauth) into a temp dir
 * and returns the file path. The CLI's NodeOAuthStorage reads this format via
 * the same `createOAuthStore` factory.
 */
function writeOAuthFixture(servers: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "inspector-cli-stored-auth-"));
  const file = join(dir, "oauth.json");
  writeFileSync(
    file,
    JSON.stringify({ state: { servers }, version: 0 }),
    "utf8",
  );
  return file;
}

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
        "--cli",
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
    expect(last.method).toBe("tools/list");
    // Express normalises header names to lowercase.
    expect(last.headers?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("merges with --header (explicit headers + stored auth coexist)", async () => {
    const result = await runCli(
      [
        "--cli",
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
      ["--cli", "--use-stored-auth", "--method", "tools/list"],
      { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: fixturePath } },
    );
    expectCliFailure(result);
    expect(result.stderr).toContain("--use-stored-auth requires --server-url");
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
          "--cli",
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
    // Store under the normalised form (lowercased host); pass the upper-cased
    // variant on the command line. The lookup should still find it.
    const normalised = normalizeServerUrl(
      serverUrl.replace("127.0.0.1", "127.0.0.1"),
    );
    const upper = serverUrl.replace("http://", "HTTP://");
    const fixture = writeOAuthFixture({
      [normalised]: {
        tokens: { access_token: TOKEN, token_type: "Bearer" },
      },
    });
    try {
      const result = await runCli(
        [
          "--cli",
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
        "--cli",
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
      const result = await runCli(["--cli", "--list-stored-auth"], {
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
    const result = await runCli(["--cli", "--list-stored-auth"], {
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
      ["--cli", "--print-handoff", "--server-url", "https://x.example/mcp"],
      {
        env: {
          MCP_INSPECTOR_API_TOKEN: "tok123",
          CLIENT_PORT: "16274",
          MCP_SANDBOX_PORT: "16275",
          MCP_STORAGE_DIR: "/tmp/inspector-storage",
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
    expect(out.oauthStatePath).toBe("/tmp/inspector-storage/oauth.json");
    expect(out.apiToken).toBe("tok123");
  });

  it("includes a note when MCP_INSPECTOR_API_TOKEN is unset", async () => {
    const result = await runCli(
      ["--cli", "--print-handoff", "--server-url", "https://x.example/mcp"],
      { env: {} },
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
    const result = await runCli(["--cli", "--print-handoff"]);
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
          state: {
            servers: {
              [normalizeServerUrl(serverUrl)]: {
                tokens: { access_token: "waited-tok", token_type: "Bearer" },
              },
            },
          },
          version: 0,
        }),
        "utf8",
      );
    }, 200);
    try {
      const result = await runCli(
        [
          "--cli",
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
        "--cli",
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
      "--cli",
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
