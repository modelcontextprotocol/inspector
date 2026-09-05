import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  getStateFilePath,
  resetNodeOAuthStorageCache,
} from "@inspector/core/auth/node/storage-node.js";
import { MIN_REVOCATION_REQUEST_BUDGET_MS } from "@inspector/core/auth/revocation.js";
import { clearStoredAuthForRelogin } from "../src/clear-stored-auth-for-relogin.js";

const AS_ISSUER = "https://as.example.com";

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

  // #2144 — RFC 7009. The request is *built* before the delete (from the token,
  // the client id and the cached metadata it removes) and *sent* after it, so
  // the local delete never waits on the network.
  describe("token revocation", () => {
    function seed(over: Record<string, unknown> = {}): string {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-relogin-revoke-"));
      const file = path.join(dir, "oauth.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          servers: {
            // Issuer-bound (SEP-2352), matching the cached metadata below: an
            // unkeyed grant records no authorization server and is refused, so
            // seeding one would make these cases assert that instead.
            "https://example.com/mcp": {
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
                revocation_endpoint: `${AS_ISSUER}/revoke`,
                response_types_supported: ["code"],
              },
              ...over,
            },
          },
          idpSessions: {},
        }),
        "utf8",
      );
      prevPath = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
      process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = file;
      resetNodeOAuthStorageCache();
      return file;
    }

    /** Seed both key spellings of one server, each with its own refresh token. */
    function seedBothSpellings(
      normalizedToken: string,
      rawToken: string,
    ): void {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-relogin-two-"));
      const file = path.join(dir, "oauth.json");
      const metadata = {
        issuer: AS_ISSUER,
        authorization_endpoint: `${AS_ISSUER}/authorize`,
        token_endpoint: `${AS_ISSUER}/token`,
        revocation_endpoint: `${AS_ISSUER}/revoke`,
        response_types_supported: ["code"],
      };
      const entry = (refresh: string) => ({
        activeIssuer: AS_ISSUER,
        byIssuer: {
          [AS_ISSUER]: {
            tokens: {
              access_token: `a-${refresh}`,
              token_type: "Bearer",
              refresh_token: refresh,
            },
          },
        },
        serverMetadata: metadata,
      });
      fs.writeFileSync(
        file,
        JSON.stringify({
          servers: {
            "https://example.com": entry(rawToken),
            "https://example.com/": entry(normalizedToken),
          },
          idpSessions: {},
        }),
        "utf8",
      );
      prevPath = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
      process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = file;
      resetNodeOAuthStorageCache();
    }

    it("revokes the stored grant, having snapshotted it before the delete", async () => {
      const file = seed();
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));
      try {
        await expect(
          clearStoredAuthForRelogin("https://example.com/mcp"),
        ).resolves.toMatchObject({
          status: "revoked",
          tokenTypeHint: "refresh_token",
        });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toBe("https://as.example.com/revoke");
        expect(new URLSearchParams(String(init?.body)).get("token")).toBe("r");
      } finally {
        fetchSpy.mockRestore();
      }
      const blob = JSON.parse(fs.readFileSync(file, "utf8")) as {
        servers: Record<string, unknown>;
      };
      expect(blob.servers["https://example.com/mcp"]).toBeUndefined();
    });

    // Both spellings resolve to the same stored entry, so this is one grant and
    // must produce one request. It also proves the walk does not stop at the
    // first empty key: the raw spelling holds nothing.
    it("sends one request when both key spellings name the same grant", async () => {
      seed();
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));
      try {
        // Normalises to the stored `https://example.com/mcp`.
        await expect(
          clearStoredAuthForRelogin("https://Example.com/mcp"),
        ).resolves.toMatchObject({ status: "revoked" });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    // Both keys are deleted, so both must be revoked: a stale entry under the
    // other spelling is still a live grant at the authorization server, and
    // dropping it locally without revoking is the exact leak this closes.
    // The *reported* outcome is the normalised key's, matching the precedence
    // `findStoredServerState` reads with — that is the grant a connect uses.
    it("revokes a stale entry under the other spelling too", async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-relogin-both-"));
      const file = path.join(dir, "oauth.json");
      const metadata = {
        issuer: AS_ISSUER,
        authorization_endpoint: `${AS_ISSUER}/authorize`,
        token_endpoint: `${AS_ISSUER}/token`,
        revocation_endpoint: `${AS_ISSUER}/revoke`,
        response_types_supported: ["code"],
      };
      fs.writeFileSync(
        file,
        JSON.stringify({
          servers: {
            // The raw spelling the transport keyed by, holding a STALE grant.
            "https://example.com": {
              activeIssuer: AS_ISSUER,
              byIssuer: {
                [AS_ISSUER]: {
                  tokens: {
                    access_token: "stale-a",
                    token_type: "Bearer",
                    refresh_token: "stale-r",
                  },
                },
              },
              serverMetadata: metadata,
            },
            // The normalised spelling, holding the CURRENT grant.
            "https://example.com/": {
              activeIssuer: AS_ISSUER,
              byIssuer: {
                [AS_ISSUER]: {
                  tokens: {
                    access_token: "live-a",
                    token_type: "Bearer",
                    refresh_token: "live-r",
                  },
                },
              },
              serverMetadata: metadata,
            },
          },
          idpSessions: {},
        }),
        "utf8",
      );
      prevPath = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
      process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = file;
      resetNodeOAuthStorageCache();

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));
      try {
        await expect(
          clearStoredAuthForRelogin("https://example.com"),
        ).resolves.toMatchObject({ status: "revoked" });
        const tokens = fetchSpy.mock.calls.map((call) =>
          new URLSearchParams(String(call[1]?.body)).get("token"),
        );
        // Normalised first, then the stale raw one — neither is left behind.
        expect(tokens).toEqual(["live-r", "stale-r"]);
      } finally {
        fetchSpy.mockRestore();
      }

      const blob = JSON.parse(fs.readFileSync(file, "utf8")) as {
        servers: Record<string, unknown>;
      };
      expect(blob.servers["https://example.com"]).toBeUndefined();
      expect(blob.servers["https://example.com/"]).toBeUndefined();
    });

    it("deletes the local entry even when the request fails", async () => {
      const file = seed();
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("unreachable"));
      try {
        await expect(
          clearStoredAuthForRelogin("https://example.com/mcp"),
        ).resolves.toMatchObject({ status: "failed" });
      } finally {
        fetchSpy.mockRestore();
      }
      const blob = JSON.parse(fs.readFileSync(file, "utf8")) as {
        servers: Record<string, unknown>;
      };
      expect(blob.servers["https://example.com/mcp"]).toBeUndefined();
    });

    it("skips the request when revocation is turned off", async () => {
      seed();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      try {
        await expect(
          clearStoredAuthForRelogin("https://example.com/mcp", {
            revoke: false,
          }),
        ).resolves.toBeUndefined();
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    // Keys are revoked from independently. Deduplicating them could only be
    // done by pre-reading one token, which would skip the second key's OTHER
    // issuer-bound grants along with it; a duplicate RFC 7009 request is
    // harmless (§2.2 makes an unknown token a success), a missed one is not.
    it("revokes from both keys even when they hold the same token", async () => {
      seedBothSpellings("same-r", "same-r");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 500 }));
      try {
        await expect(
          clearStoredAuthForRelogin("https://example.com"),
        ).resolves.toMatchObject({ status: "failed" });
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    // A grant still live at the authorization server is what the user needs to
    // hear about; reporting the earlier success would print no warning at all.
    // One budget across both keys, so a first request that outlives it fails
    // rather than each key getting a fresh five seconds.
    it("bounds both keys with one shared budget", async () => {
      seedBothSpellings("live-r", "stale-r");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => {
          // Outlives the injected budget, so the second key is never attempted.
          await new Promise((r) => setTimeout(r, 40));
          return new Response(null, { status: 200 });
        });
      try {
        const outcome = await clearStoredAuthForRelogin("https://example.com", {
          budgetMs: 20,
        });
        expect(outcome).toMatchObject({ status: "failed" });
        expect(outcome?.status === "failed" ? outcome.detail : "").toContain(
          "timed out after 20ms",
        );
      } finally {
        fetchSpy.mockRestore();
      }
    });

    // A plan reached with no budget left is reported rather than firing a
    // request it would immediately abandon — and that report must outrank an
    // earlier success, since the unattempted key's grant may still be live.
    it("reports exhaustion for a key it never attempted", async () => {
      seedBothSpellings("live-r", "stale-r");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));
      try {
        const outcome = await clearStoredAuthForRelogin("https://example.com", {
          budgetMs: 0,
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(outcome).toMatchObject({ status: "failed" });
        expect(outcome?.status === "failed" ? outcome.detail : "").toContain(
          "budget was exhausted",
        );
      } finally {
        fetchSpy.mockRestore();
      }
    });

    // The zero-budget case above passes under the old `remainingMs <= 0` bound
    // too, so it says nothing about the floor. This one is the floor's own
    // detector: a budget that is genuinely positive, and genuinely too small to
    // complete a request, must be spent on no request at all (#2252). The
    // budget only shrinks as the loop runs, so a slow machine cannot flip it.
    it("issues no request for a positive budget below the minimum", async () => {
      seedBothSpellings("live-r", "stale-r");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));
      try {
        const outcome = await clearStoredAuthForRelogin("https://example.com", {
          budgetMs: MIN_REVOCATION_REQUEST_BUDGET_MS - 1,
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(outcome).toMatchObject({ status: "failed" });
        // The *plan* was never attempted, so the report has to be this loop's
        // own — naming the server URL — and not the per-grant one from inside
        // `executeOAuthRevocation`. Without that distinction the assertion
        // passes on the old `<= 0` bound too: the plan would be handed a 4ms
        // budget, and core's identical floor would decline it one level down.
        expect(outcome?.status === "failed" ? outcome.detail : "").toContain(
          'budget was exhausted before "',
        );
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("reports a later failure over an earlier success", async () => {
      seedBothSpellings("live-r", "stale-r");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValue(new Response(null, { status: 500 }));
      try {
        await expect(
          clearStoredAuthForRelogin("https://example.com"),
        ).resolves.toMatchObject({ status: "failed" });
      } finally {
        fetchSpy.mockRestore();
      }
    });

    // `getTokens` parses through `OAuthTokensSchema`, so a persisted token that
    // no longer validates rejects. That must not abandon the local delete
    // `--relogin` promises — over a grant that could not have been revoked.
    it("still clears when the stored token cannot be parsed", async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-relogin-bad-token-"));
      const file = path.join(dir, "oauth.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          servers: {
            "https://example.com/mcp": {
              activeIssuer: AS_ISSUER,
              byIssuer: {
                // No `token_type` — fails OAuthTokensSchema.
                [AS_ISSUER]: { tokens: { access_token: 42 } },
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

      await expect(
        clearStoredAuthForRelogin("https://example.com/mcp"),
      ).resolves.toMatchObject({ status: "failed" });

      const blob = JSON.parse(fs.readFileSync(file, "utf8")) as {
        servers: Record<string, unknown>;
      };
      expect(blob.servers["https://example.com/mcp"]).toBeUndefined();
    });

    it("reports no_tokens when the store holds nothing for the server", async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-relogin-empty-"));
      const file = path.join(dir, "oauth.json");
      fs.writeFileSync(
        file,
        JSON.stringify({ servers: {}, idpSessions: {} }),
        "utf8",
      );
      prevPath = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
      process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = file;
      resetNodeOAuthStorageCache();

      await expect(
        clearStoredAuthForRelogin("https://example.com/mcp"),
      ).resolves.toEqual({ status: "skipped", reason: "no_tokens" });
    });
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
