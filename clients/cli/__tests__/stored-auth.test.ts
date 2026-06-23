import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliFailure, expectCliSuccess } from "./helpers/assertions.js";
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

  it("errors clearly when no token is stored for the given server URL", async () => {
    const empty = writeOAuthFixture({});
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
        { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: empty } },
      );
      expectCliFailure(result);
      expect(result.stderr).toContain("No stored OAuth token");
      expect(result.stderr).toContain(serverUrl);
    } finally {
      rmSync(empty, { force: true });
    }
  });
});
