import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getStateFilePath,
  resetNodeOAuthStorageCache,
} from "@inspector/core/auth/node/storage-node.js";
import { clearStoredAuthForRelogin } from "../src/clear-stored-auth-for-relogin.js";

describe("clearStoredAuthForRelogin", () => {
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

  it("no-ops when serverUrl is missing or blank", async () => {
    await clearStoredAuthForRelogin(undefined);
    await clearStoredAuthForRelogin("   ");
  });

  it("clears a URL-keyed entry and tolerates non-URL keys", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-relogin-"));
    const file = path.join(dir, "oauth.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        servers: {
          "https://example.com/mcp": {
            tokens: { access_token: "a", token_type: "Bearer" },
          },
          "not a url": {
            tokens: { access_token: "b", token_type: "Bearer" },
          },
        },
        idpSessions: {},
      }),
      "utf8",
    );
    prevPath = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
    process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = file;
    resetNodeOAuthStorageCache();
    expect(getStateFilePath()).toBe(file);

    await clearStoredAuthForRelogin("https://example.com/mcp");
    let blob = JSON.parse(fs.readFileSync(file, "utf8")) as {
      servers: Record<string, unknown>;
    };
    expect(blob.servers["https://example.com/mcp"]).toBeUndefined();
    expect(blob.servers["not a url"]).toBeDefined();

    // normalizeServerUrl catch path — clears under the raw key
    await clearStoredAuthForRelogin("not a url");
    blob = JSON.parse(fs.readFileSync(file, "utf8")) as {
      servers: Record<string, unknown>;
    };
    expect(blob.servers["not a url"]).toBeUndefined();
  });

  it("clears both raw and URL-normalised keys (bare origin / mixed-case host)", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-relogin-norm-"));
    const file = path.join(dir, "oauth.json");
    // Runtime storage keys by the transport's raw url string — often without a
    // trailing slash / with mixed-case host — while new URL().href normalises.
    fs.writeFileSync(
      file,
      JSON.stringify({
        servers: {
          "https://example.com": {
            tokens: { access_token: "bare", token_type: "Bearer" },
          },
          "https://example.com/": {
            tokens: { access_token: "slash", token_type: "Bearer" },
          },
          "https://Example.com/mcp": {
            tokens: { access_token: "mixed", token_type: "Bearer" },
          },
        },
        idpSessions: {},
      }),
      "utf8",
    );
    prevPath = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
    process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = file;
    resetNodeOAuthStorageCache();

    await clearStoredAuthForRelogin("https://example.com");
    let blob = JSON.parse(fs.readFileSync(file, "utf8")) as {
      servers: Record<string, unknown>;
    };
    expect(blob.servers["https://example.com"]).toBeUndefined();
    expect(blob.servers["https://example.com/"]).toBeUndefined();
    expect(blob.servers["https://Example.com/mcp"]).toBeDefined();

    await clearStoredAuthForRelogin("https://Example.com/mcp");
    blob = JSON.parse(fs.readFileSync(file, "utf8")) as {
      servers: Record<string, unknown>;
    };
    expect(blob.servers["https://Example.com/mcp"]).toBeUndefined();
    // Normalised key (lowercased host) is cleared too when distinct.
    expect(blob.servers["https://example.com/mcp"]).toBeUndefined();
  });
});
