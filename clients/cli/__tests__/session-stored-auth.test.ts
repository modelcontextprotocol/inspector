import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resetNodeOAuthStorageCache } from "@inspector/core/auth/node/storage-node.js";
import {
  clearAllStoredAuth,
  clearStoredAuth,
  clearStoredAuthForRelogin,
  listStoredAuth,
  resolveStoredAuthKey,
} from "../src/session/stored-auth.js";
import { CliExitCodeError } from "../src/error-handler.js";
import { runMcp } from "./helpers/mcp-runner.js";
import { expectCliSuccess, expectCliFailure } from "./helpers/assertions.js";

function writeOAuthFixture(dir: string): string {
  const file = path.join(dir, "oauth.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      servers: {
        "https://example.com/mcp": {
          byIssuer: {
            "https://as.example/": {
              tokens: {
                access_token: "a",
                token_type: "Bearer",
                refresh_token: "r",
              },
            },
          },
          activeIssuer: "https://as.example/",
        },
        "https://other.example/mcp": {
          tokens: { access_token: "x", token_type: "Bearer" },
        },
        "https://empty.example/mcp": {
          codeVerifier: "cv",
        },
        "https://nullish.example/mcp": null,
        "https://stringish.example/mcp": "not-an-object",
        "https://issuer-empty.example/mcp": {
          byIssuer: {
            "https://as.example/": {},
          },
        },
      },
      idpSessions: {},
    }),
    "utf8",
  );
  return file;
}

describe("session stored-auth helpers", () => {
  let dir: string | undefined;
  let prevPath: string | undefined;

  afterEach(() => {
    if (prevPath === undefined)
      delete process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
    else process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = prevPath;
    resetNodeOAuthStorageCache();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function useFixture(): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-stored-auth-"));
    const file = writeOAuthFixture(dir);
    prevPath = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
    process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = file;
    resetNodeOAuthStorageCache();
    return file;
  }

  it("lists byIssuer and legacy tokens", async () => {
    const file = useFixture();
    const list = await listStoredAuth();
    expect(list.oauthStatePath).toBe(file);
    expect(list.servers.map((s) => s.url)).toEqual([
      "https://empty.example/mcp",
      "https://example.com/mcp",
      "https://issuer-empty.example/mcp",
      "https://nullish.example/mcp",
      "https://other.example/mcp",
      "https://stringish.example/mcp",
    ]);
    expect(list.servers.find((s) => s.url.includes("nullish"))).toMatchObject({
      hasTokens: false,
      hasRefreshToken: false,
    });
    expect(list.servers.find((s) => s.url.includes("stringish"))).toMatchObject(
      { hasTokens: false, hasRefreshToken: false },
    );
    expect(
      list.servers.find((s) => s.url.includes("issuer-empty")),
    ).toMatchObject({ hasTokens: false, hasRefreshToken: false });
    expect(
      list.servers.find((s) => s.url.includes("example.com")),
    ).toMatchObject({ hasTokens: true, hasRefreshToken: true });
    expect(list.servers.find((s) => s.url.includes("other"))).toMatchObject({
      hasTokens: true,
      hasRefreshToken: false,
    });
    expect(list.servers.find((s) => s.url.includes("empty"))).toMatchObject({
      hasTokens: false,
      hasRefreshToken: false,
    });
  });

  it("clears one key and all keys", async () => {
    useFixture();
    const cleared = await clearStoredAuth("https://example.com/mcp");
    expect(cleared.url).toBe("https://example.com/mcp");
    let list = await listStoredAuth();
    expect(list.servers.map((s) => s.url)).not.toContain(
      "https://example.com/mcp",
    );

    const all = await clearAllStoredAuth();
    expect(all.cleared).toBe(5);
    list = await listStoredAuth();
    expect(list.servers).toEqual([]);
  });

  it("resolveStoredAuthKey rejects unknown non-URL keys", async () => {
    useFixture();
    await expect(resolveStoredAuthKey("nope")).rejects.toBeInstanceOf(
      CliExitCodeError,
    );
  });

  it("clearStoredAuthForRelogin clears by URL", async () => {
    useFixture();
    await clearStoredAuthForRelogin("https://other.example/mcp");
    const list = await listStoredAuth();
    expect(list.servers.map((s) => s.url)).not.toContain(
      "https://other.example/mcp",
    );
    await clearStoredAuthForRelogin(undefined);
    await clearStoredAuthForRelogin("   ");
  });

  it("lists an empty store when the file is missing", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-stored-auth-"));
    const missing = path.join(dir, "missing-oauth.json");
    prevPath = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
    process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = missing;
    resetNodeOAuthStorageCache();
    expect(await listStoredAuth()).toMatchObject({
      oauthStatePath: missing,
      servers: [],
    });
  });

  it("resolves keys by normalisation and rejects blanks", async () => {
    useFixture();
    await expect(resolveStoredAuthKey("   ")).rejects.toBeInstanceOf(
      CliExitCodeError,
    );
    await expect(resolveStoredAuthKey("https://Example.COM/mcp")).resolves.toBe(
      "https://example.com/mcp",
    );
    await expect(
      resolveStoredAuthKey("https://brand-new.example/mcp"),
    ).resolves.toBe("https://brand-new.example/mcp");
  });
});

describe("mcp auth/list and auth/clear", () => {
  let dir: string | undefined;

  afterEach(() => {
    resetNodeOAuthStorageCache();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("lists and clears via session commands", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-auth-cmd-"));
    const file = writeOAuthFixture(dir);
    resetNodeOAuthStorageCache();

    const listed = await runMcp(["auth/list", "--format", "json"], {
      env: { MCP_INSPECTOR_OAUTH_STATE_PATH: file },
    });
    expectCliSuccess(listed);
    const body = JSON.parse(listed.stdout) as {
      servers: { url: string }[];
    };
    expect(body.servers.length).toBe(6);

    const cleared = await runMcp(
      ["auth/clear", "https://example.com/mcp", "--format", "json"],
      { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: file } },
    );
    expectCliSuccess(cleared);
    expect(JSON.parse(cleared.stdout)).toEqual({
      url: "https://example.com/mcp",
    });

    const all = await runMcp(
      ["auth/clear", "--all", "--yes", "--format", "json"],
      { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: file } },
    );
    expectCliSuccess(all);
    expect(JSON.parse(all.stdout)).toMatchObject({ all: true, cleared: 5 });
  });

  it("rejects --all without --yes when non-interactive", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-auth-cmd-"));
    const file = writeOAuthFixture(dir);
    const result = await runMcp(["auth/clear", "--all"], {
      env: { MCP_INSPECTOR_OAUTH_STATE_PATH: file },
    });
    expectCliFailure(result);
    expect(result.stderr).toMatch(/--yes/);
  });

  it("rejects auth/clear usage errors", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-auth-cmd-"));
    const file = writeOAuthFixture(dir);
    const none = await runMcp(["auth/clear"], {
      env: { MCP_INSPECTOR_OAUTH_STATE_PATH: file },
    });
    expectCliFailure(none);

    const both = await runMcp(
      ["auth/clear", "https://example.com/mcp", "--all", "--yes"],
      { env: { MCP_INSPECTOR_OAUTH_STATE_PATH: file } },
    );
    expectCliFailure(both);

    const human = await runMcp(["auth/list"], {
      env: { MCP_INSPECTOR_OAUTH_STATE_PATH: file },
    });
    expectCliSuccess(human);
    expect(human.stdout).toMatch(/Stored auth/);
  });
});
