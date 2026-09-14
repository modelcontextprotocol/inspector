/**
 * `--relogin` token revocation, driven through `runCli` (#2144).
 *
 * The helper's own tests cover `clearStoredAuthForRelogin({ revoke })`. What
 * they cannot cover is the wiring above it: that Commander maps `--no-revoke`,
 * that the per-server `oauth.revokeOnClear` reaches the call, and that a failed
 * revocation is reported without changing what `--relogin` does. A regression
 * in any of those turns revocation silently back on or off, which is precisely
 * the class of bug the opt-out exists to make controllable.
 *
 * Every case here fails to connect on purpose — the fetch double refuses
 * everything but the revocation endpoint. That is fine: revocation runs before
 * the connect, so the assertions are about the requests made and the warnings
 * printed, not about the exit code.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resetNodeOAuthStorageCache } from "@inspector/core/auth/node/storage-node.js";
import { runCli } from "./helpers/cli-runner.js";

const SERVER_URL = "https://example.com/mcp";
const AS_ISSUER = "https://as.example.com";
const REVOKE_URL = `${AS_ISSUER}/revoke`;

let dir: string | undefined;
let prevPath: string | undefined;

afterEach(() => {
  if (prevPath === undefined) delete process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
  else process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = prevPath;
  prevPath = undefined;
  resetNodeOAuthStorageCache();
  vi.restoreAllMocks();
  if (dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

/** Seed an OAuth store holding a revocable grant for {@link SERVER_URL}. */
function seedStore(): void {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-relogin-revoke-e2e-"));
  const file = path.join(dir, "oauth.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      servers: {
        // Issuer-bound (SEP-2352) and matching the cached metadata: an unkeyed
        // grant records no authorization server and is deliberately refused.
        [SERVER_URL]: {
          activeIssuer: AS_ISSUER,
          byIssuer: {
            [AS_ISSUER]: {
              tokens: {
                access_token: "a",
                token_type: "Bearer",
                refresh_token: "r",
              },
            },
          },
          serverMetadata: {
            issuer: AS_ISSUER,
            authorization_endpoint: `${AS_ISSUER}/authorize`,
            token_endpoint: `${AS_ISSUER}/token`,
            revocation_endpoint: REVOKE_URL,
            response_types_supported: ["code"],
          },
        },
      },
      idpSessions: {},
    }),
    "utf8",
  );
  prevPath = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
  process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = file;
  resetNodeOAuthStorageCache();
}

/**
 * Answer the revocation endpoint with `status` and refuse everything else, so
 * the run stops at the connect instead of reaching the network.
 */
function stubFetch(status = 200): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    if (String(input instanceof Request ? input.url : input) === REVOKE_URL) {
      return Promise.resolve(new Response(null, { status }));
    }
    return Promise.reject(new Error("network blocked in test"));
  }) as ReturnType<typeof vi.spyOn>;
}

function revocationCalls(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.filter(
    (call) => String(call[0] as string) === REVOKE_URL,
  );
}

/** A catalog holding one HTTP server, optionally opting out of revocation. */
function writeCatalog(revokeOnClear?: boolean): string {
  const catalogDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cli-relogin-catalog-"),
  );
  const catalogPath = path.join(catalogDir, "mcp.json");
  fs.writeFileSync(
    catalogPath,
    JSON.stringify({
      mcpServers: {
        remote: {
          type: "streamable-http",
          url: SERVER_URL,
          ...(revokeOnClear !== undefined && { oauth: { revokeOnClear } }),
        },
      },
    }),
    "utf8",
  );
  return catalogPath;
}

describe("--relogin token revocation", () => {
  it("revokes the stored grant by default", async () => {
    seedStore();
    const fetchSpy = stubFetch();

    await runCli([
      "--relogin",
      "--server-url",
      SERVER_URL,
      "--method",
      "tools/list",
    ]);

    expect(revocationCalls(fetchSpy)).toHaveLength(1);
  });

  // Commander turns `--no-revoke` into `options.revoke === false`; nothing else
  // proves that mapping survives a refactor of the flag.
  it("--no-revoke skips the request", async () => {
    seedStore();
    const fetchSpy = stubFetch();

    await runCli([
      "--relogin",
      "--no-revoke",
      "--server-url",
      SERVER_URL,
      "--method",
      "tools/list",
    ]);

    expect(revocationCalls(fetchSpy)).toHaveLength(0);
  });

  it("honors the per-server oauth.revokeOnClear opt-out", async () => {
    seedStore();
    const catalogPath = writeCatalog(false);
    const fetchSpy = stubFetch();
    try {
      await runCli([
        "--catalog",
        catalogPath,
        "--server",
        "remote",
        "--relogin",
        "--method",
        "tools/list",
      ]);
      expect(revocationCalls(fetchSpy)).toHaveLength(0);
    } finally {
      fs.rmSync(path.dirname(catalogPath), { recursive: true, force: true });
    }
  });

  it("revokes for a catalog server that did not opt out", async () => {
    seedStore();
    const catalogPath = writeCatalog();
    const fetchSpy = stubFetch();
    try {
      await runCli([
        "--catalog",
        catalogPath,
        "--server",
        "remote",
        "--relogin",
        "--method",
        "tools/list",
      ]);
      expect(revocationCalls(fetchSpy)).toHaveLength(1);
    } finally {
      fs.rmSync(path.dirname(catalogPath), { recursive: true, force: true });
    }
  });

  // Inert-but-accepted flags are rejected in this parser (see the `--strict`
  // rationale in `cli.ts`). On its own `--no-revoke` reads as "this run will
  // not revoke anything", which is true only because nothing was being cleared.
  it("rejects --no-revoke without --relogin", async () => {
    const result = await runCli([
      "--no-revoke",
      "--server-url",
      SERVER_URL,
      "--method",
      "tools/list",
    ]);
    expect(result.stderr).toMatch(/--no-revoke requires --relogin/);
  });

  // A failed revocation must be visible — the grant is still live at the
  // authorization server — without turning `--relogin` into a failure, which
  // is a local delete the user still gets.
  it("warns on stderr when the authorization server refuses", async () => {
    seedStore();
    stubFetch(500);

    const result = await runCli([
      "--relogin",
      "--server-url",
      SERVER_URL,
      "--method",
      "tools/list",
    ]);

    expect(result.stderr).toMatch(/could not revoke the OAuth grant/i);
  });
});
