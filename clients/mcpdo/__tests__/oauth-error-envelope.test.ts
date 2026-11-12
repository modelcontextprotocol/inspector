import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { OAuthError } from "@modelcontextprotocol/client";
import { EXIT_CODES } from "@inspector/core/cli/error-handler.js";
import { DaemonServer } from "../src/daemon/server.js";
import { relayedEnvelope } from "../src/daemon/client.js";
import { removeDaemonDir } from "./helpers/daemon-endpoint.js";

/**
 * An OAuth protocol failure's envelope across mcpdo's daemon socket (#2842).
 * The envelope is built by the shared `core/cli/error-handler.ts`; these
 * tests cover the hop, where the authorization server's `error` /
 * `error_description` fields would otherwise be dropped.
 */
describe("mcpdo oauth_error envelope", () => {
  let dir: string | undefined;
  let server: DaemonServer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) {
      await server.stop("stop");
      server = undefined;
    }
    if (dir) {
      removeDaemonDir(dir);
      dir = undefined;
    }
  });

  it("relays a classified OAuthError's server fields on the daemon error body", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpdo-oauth-"));
    server = new DaemonServer({ dir, idleMs: 0 });
    vi.spyOn(server.registry, "list").mockImplementationOnce(() => {
      throw new OAuthError("invalid_grant", "Refresh token revoked");
    });
    const response = await server.handle({ id: "1", op: "connections/list" });
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.error).toEqual({
      code: "oauth_error",
      message: "Refresh token revoked",
      exitCode: EXIT_CODES.AUTH_REQUIRED,
      oauthError: "invalid_grant",
      oauthErrorDescription: "Refresh token revoked",
    });
  });
});

describe("relayedEnvelope OAuth fields", () => {
  it("rebuilds the OAuth fields on the client, sanitizing the server text", () => {
    expect(
      relayedEnvelope({
        code: "oauth_error",
        message: "m",
        oauthError: "access_denied",
        oauthErrorDescription: "nope\u001b[2J",
      }),
    ).toEqual({
      code: "oauth_error",
      oauthError: "access_denied",
      oauthErrorDescription: "nope␛[2J",
    });
  });
});
