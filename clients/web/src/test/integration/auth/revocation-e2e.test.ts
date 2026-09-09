/**
 * RFC 7009 revocation against the real OAuth test server (#2144).
 *
 * The unit suite (`src/test/core/auth/revocation.test.ts`) pins what is *sent*;
 * this pins what the request actually *does*. The two halves that only a real
 * authorization server can show are both here: that the Inspector's request is
 * accepted at all (its client authentication and form encoding are right), and
 * that §2.1's grant linkage holds — one request naming the refresh token kills
 * the access token issued alongside it, which is the whole reason the Inspector
 * sends one request rather than two.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TestServerHttp,
  createOAuthTestServerConfig,
  getDefaultServerConfig,
  waitForOAuthWellKnown,
} from "@modelcontextprotocol/inspector-test-server";
// NOT `BrowserOAuthStorage`: the `integration` project runs in the node
// environment, where `sessionStorage` does not exist. Node 22 gates Web Storage
// behind a flag and newer Node exposes it by default, so a browser-backed store
// passes on a developer's machine and fails in CI — which is exactly what
// happened here.
import { NodeOAuthStorage } from "@inspector/core/auth/node/storage-node.js";
import {
  clearAndPlanRevocation,
  executeOAuthRevocation,
} from "@inspector/core/auth/revocation.js";
import type { TokenRevocationOutcome } from "@inspector/core/auth/revocation.js";
import type { OAuthMetadata } from "@modelcontextprotocol/client";

const CLIENT_ID = "test-2144-revocation";
const CLIENT_SECRET = "test-2144-secret";
const REDIRECT_URL = "http://localhost:3000/oauth/callback";
/** A second registered client, used to prove tokens are not cross-revocable. */
const OTHER_CLIENT_ID = "test-2144-other";
const OTHER_CLIENT_SECRET = "test-2144-other-secret";
/**
 * A third client whose secret carries the character #2222 was filed about — a
 * `+`, which the two encoding algorithms treat differently and which base64
 * secrets (the kind an authorization server most often hands out) contain
 * routinely. The Inspector's encoding turns out to handle it, but nothing here
 * demonstrated that before, so this client is what makes the claim testable
 * rather than argued.
 */
const PLUS_CLIENT_ID = "test-2222-plus";
const PLUS_CLIENT_SECRET = "aG9sZA+bXk/beer=";

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

describe("OAuth token revocation (RFC 7009)", () => {
  let mcpServer: TestServerHttp | null = null;
  let serverUrl = "";
  let storageDir = "";
  let metadata: OAuthMetadata;

  beforeAll(async () => {
    mcpServer = new TestServerHttp({
      ...getDefaultServerConfig(),
      serverType: "streamable-http" as const,
      ...createOAuthTestServerConfig({
        requireAuth: true,
        staticClients: [
          {
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            redirectUris: [REDIRECT_URL],
          },
          {
            clientId: OTHER_CLIENT_ID,
            clientSecret: OTHER_CLIENT_SECRET,
            redirectUris: [REDIRECT_URL],
          },
          {
            clientId: PLUS_CLIENT_ID,
            clientSecret: PLUS_CLIENT_SECRET,
            redirectUris: [REDIRECT_URL],
          },
        ],
      }),
    });
    const port = await mcpServer.start();
    serverUrl = `http://localhost:${port}`;
    storageDir = mkdtempSync(join(tmpdir(), "mcp-inspector-2144-"));
    await waitForOAuthWellKnown(serverUrl);
    metadata = (await (
      await fetch(`${serverUrl}/.well-known/oauth-authorization-server`)
    ).json()) as OAuthMetadata;
  }, 30_000);

  afterAll(async () => {
    await mcpServer?.stop();
    mcpServer = null;
    if (storageDir) {
      rmSync(storageDir, { recursive: true, force: true });
      storageDir = "";
    }
  }, 30_000);

  /** Run a real authorization-code exchange and return the issued tokens. */
  async function authorize(
    clientId: string = CLIENT_ID,
    clientSecret: string = CLIENT_SECRET,
  ): Promise<{
    access_token: string;
    refresh_token: string;
  }> {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());

    const authorizeResponse = await fetch(`${serverUrl}/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT_URL,
        response_type: "code",
        scope: "mcp",
        code_challenge: challenge,
        code_challenge_method: "S256",
      }),
    });
    const location = authorizeResponse.headers.get("location");
    expect(location).toBeTruthy();
    const code = new URL(location!).searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenResponse = await fetch(`${serverUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: REDIRECT_URL,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: verifier,
      }),
    });
    expect(tokenResponse.status).toBe(200);
    return (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };
  }

  /** Whether the MCP endpoint still accepts this bearer token. */
  async function tokenAccepted(accessToken: string): Promise<boolean> {
    const response = await fetch(`${serverUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.status !== 401;
  }

  async function seededStorage(
    tokens: {
      access_token: string;
      refresh_token?: string;
    },
    clientId: string = CLIENT_ID,
    clientSecret: string = CLIENT_SECRET,
  ): Promise<NodeOAuthStorage> {
    const storage = new NodeOAuthStorage(join(storageDir, "oauth.json"));
    await storage.clear(serverUrl);
    // Issuer-bound and matching the discovered metadata: an unkeyed grant
    // records no authorization server and is deliberately refused.
    await storage.saveTokens(
      serverUrl,
      { token_type: "Bearer", ...tokens },
      { issuer: metadata.issuer },
    );
    await storage.saveServerMetadata(serverUrl, metadata);
    // Preconfigured, so it goes in the preregistered slot — the same one a
    // server with `oauth.clientId` uses. That is the slot the revocation path
    // must read first, or a confidential client sends no authentication at all.
    await storage.savePreregisteredClientInformation(serverUrl, {
      client_id: clientId,
      client_secret: clientSecret,
    });
    return storage;
  }

  // The fixture enforces RFC 7009 §2.1 client authentication, so this is what
  // makes the passing cases below mean something: a request with the wrong
  // credentials is refused, and the endpoint is not simply answering 200 to
  // anything.
  it("refuses a revocation request with the wrong client secret", async () => {
    const response = await fetch(`${serverUrl}/oauth/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:wrong`).toString("base64")}`,
      },
      body: new URLSearchParams({ token: "anything" }),
    });
    expect(response.status).toBe(401);
  });

  it("refuses a revocation request naming no client at all", async () => {
    const response = await fetch(`${serverUrl}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: "anything" }),
    });
    expect(response.status).toBe(401);
  });

  // RFC 7009 §2.1: only the client a token was issued to may revoke it. The
  // response stays 200 (§2.2 — it must not tell one client whether another's
  // token exists), so the assertion is that the token still works.
  it("does not revoke a token belonging to a different client", async () => {
    const tokens = await authorize();
    const response = await fetch(`${serverUrl}/oauth/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${OTHER_CLIENT_ID}:${OTHER_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        token: tokens.refresh_token,
        token_type_hint: "refresh_token",
      }),
    });

    expect(response.status).toBe(200);
    expect(await tokenAccepted(tokens.access_token)).toBe(true);
  });

  /**
   * The caller's real sequence — take-and-clear atomically, then send — so this
   * exercises the ordering the product uses rather than a convenience wrapper.
   */
  async function clearAndRevoke(
    storage: NodeOAuthStorage,
  ): Promise<TokenRevocationOutcome> {
    const plan = await clearAndPlanRevocation({ serverUrl, storage });
    return executeOAuthRevocation(plan, { fetchFn: fetch });
  }

  it("advertises a revocation endpoint", () => {
    expect(metadata.revocation_endpoint).toBe(`${serverUrl}/oauth/revoke`);
  });

  // The failure this feature exists to fix: without the request, the token is
  // still accepted after the Inspector has forgotten it.
  it("revokes the whole grant from the stored refresh token", async () => {
    const tokens = await authorize();
    expect(await tokenAccepted(tokens.access_token)).toBe(true);

    const outcome = await clearAndRevoke(await seededStorage(tokens));

    expect(outcome).toMatchObject({
      status: "revoked",
      tokenTypeHint: "refresh_token",
    });
    // RFC 7009 §2.1 — the access token issued under the same grant dies too,
    // which is why one request is enough.
    expect(await tokenAccepted(tokens.access_token)).toBe(false);
  });

  it("revokes an access token when no refresh token was issued", async () => {
    const tokens = await authorize();
    const outcome = await clearAndRevoke(
      await seededStorage({ access_token: tokens.access_token }),
    );

    expect(outcome).toMatchObject({
      status: "revoked",
      tokenTypeHint: "access_token",
    });
    expect(await tokenAccepted(tokens.access_token)).toBe(false);
  });

  // RFC 7009 §2.2: an unknown token is a success, so revoking a grant the
  // server has already expired must not be reported as a failure.
  it("treats an already-unknown token as revoked", async () => {
    const storage = await seededStorage({ access_token: "never-issued" });
    await expect(clearAndRevoke(storage)).resolves.toMatchObject({
      status: "revoked",
    });
  });

  // #2222. The fixture used to decode with `decodeURIComponent`, the exact
  // inverse of the encoder under test, so the round trip succeeded for every
  // input and no case in this file could tell a correct encoder from a wrong
  // one. `/oauth/revoke` now runs the form-urldecode a compliant authorization
  // server runs, which is what gives this case teeth: it passes only because
  // `encodeURIComponent` escapes `+` as `%2B`, and would fail against an
  // encoder that emitted a bare one.
  it("revokes a grant whose client secret contains a plus", async () => {
    const tokens = await authorize(PLUS_CLIENT_ID, PLUS_CLIENT_SECRET);
    expect(await tokenAccepted(tokens.access_token)).toBe(true);

    const outcome = await clearAndRevoke(
      await seededStorage(tokens, PLUS_CLIENT_ID, PLUS_CLIENT_SECRET),
    );

    expect(outcome).toMatchObject({
      status: "revoked",
      tokenTypeHint: "refresh_token",
    });
    expect(await tokenAccepted(tokens.access_token)).toBe(false);
  });

  // The guard on the fixture itself, and the one case that separates the two
  // decoders. An *unencoded* credential is what the SDK's `applyBasicAuth`
  // sends, and a compliant server form-urldecodes it anyway — so a `+` in the
  // secret comes back as a space and the credential is refused. Under the old
  // `decodeURIComponent` fixture this same request was accepted (a string with
  // no `%` in it decodes to itself), which is precisely why that fixture could
  // not fail on an encoding mistake. Revert `/oauth/revoke` and this test goes
  // red.
  it("refuses an unencoded Basic credential whose secret contains a plus", async () => {
    const raw = `${PLUS_CLIENT_ID}:${PLUS_CLIENT_SECRET}`;
    const response = await fetch(`${serverUrl}/oauth/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(raw).toString("base64")}`,
      },
      body: new URLSearchParams({ token: "anything" }),
    });
    expect(response.status).toBe(401);
  });
});
