import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OAuthMetadata } from "@modelcontextprotocol/client";
import { BrowserOAuthStorage } from "@inspector/core/auth/browser/storage.js";
import {
  DEFAULT_REVOCATION_TIMEOUT_MS,
  MIN_REVOCATION_REQUEST_BUDGET_MS,
  aggregateOutcomes,
  buildRevocationRequest,
  revocationAuthMethods,
  clearAndPlanRevocation,
  executeOAuthRevocation,
  revokeToken,
  selectRevocableToken,
} from "@inspector/core/auth/revocation.js";
import type { InspectorLogger } from "@inspector/core/logging/index.js";
import type { TokenRevocationOutcome } from "@inspector/core/auth/revocation.js";

/** A fully-typed `InspectorLogger` double, so the mock's shape is checked. */
function fakeLogger(): InspectorLogger {
  return {
    level: "info",
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    child: vi.fn(() => fakeLogger()),
  };
}

const SERVER_URL = "https://mcp.example.com/mcp";
const REVOKE_URL = "https://as.example.com/revoke";

function metadata(over: Partial<OAuthMetadata> = {}): OAuthMetadata {
  return {
    issuer: "https://as.example.com",
    authorization_endpoint: "https://as.example.com/authorize",
    token_endpoint: "https://as.example.com/token",
    response_types_supported: ["code"],
    revocation_endpoint: REVOKE_URL,
    ...over,
  } as OAuthMetadata;
}

function body(init: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init.body));
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

describe("selectRevocableToken", () => {
  // RFC 7009 §2.1 — revoking the refresh token asks the AS to invalidate the
  // access tokens under the same grant, so one request covers both. Naming the
  // access token instead would leave the long-lived half alive.
  it("prefers the refresh token when one exists", () => {
    expect(
      selectRevocableToken({
        access_token: "a",
        token_type: "Bearer",
        refresh_token: "r",
      }),
    ).toEqual({ token: "r", tokenTypeHint: "refresh_token" });
  });

  it("falls back to the access token", () => {
    expect(
      selectRevocableToken({ access_token: "a", token_type: "Bearer" }),
    ).toEqual({ token: "a", tokenTypeHint: "access_token" });
  });

  it("has nothing to revoke without tokens", () => {
    expect(selectRevocableToken(undefined)).toBeNull();
    expect(
      selectRevocableToken({ access_token: "", token_type: "Bearer" }),
    ).toBeNull();
  });
});

describe("revocationAuthMethods", () => {
  it("prefers the revocation endpoint's own list", () => {
    expect(
      revocationAuthMethods(
        metadata({
          revocation_endpoint_auth_methods_supported: ["client_secret_post"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
        }),
      ),
    ).toEqual(["client_secret_post"]);
  });

  // RFC 8414 §2 defaults an omitted revocation list to `client_secret_basic` —
  // it does NOT inherit the token endpoint's. Inheriting would send POST
  // credentials to an endpoint that never advertised that method.
  it("ignores the token endpoint's list", () => {
    expect(
      revocationAuthMethods(
        metadata({
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        }),
      ),
    ).toEqual(["client_secret_basic"]);
  });

  // Named literally, not left empty. An empty list means "the metadata said
  // nothing" to `selectClientAuthMethod`, which then honors whatever the
  // client's own registration declares — so a client registered
  // `client_secret_post` could put credentials in the body of a request to an
  // endpoint that promised only Basic. (`OAuthClientInformation` does not carry
  // that field, so this path cannot construct the case today; naming the
  // default is what keeps it true if the type widens.)
  it("names the RFC 8414 default when the revocation list is absent", () => {
    expect(revocationAuthMethods(metadata())).toEqual(["client_secret_basic"]);
  });

  it("the default resolves to Basic for a confidential client", () => {
    const { init } = buildRevocationRequest({
      endpoint: REVOKE_URL,
      token: "r",
      tokenTypeHint: "refresh_token",
      clientInformation: { client_id: "cid", client_secret: "sec" },
      supportedAuthMethods: revocationAuthMethods(metadata()),
    });
    expect(headerOf(init, "Authorization")).toBe(`Basic ${btoa("cid:sec")}`);
  });

  it("the default leaves a public client unauthenticated", () => {
    const { init } = buildRevocationRequest({
      endpoint: REVOKE_URL,
      token: "r",
      tokenTypeHint: "refresh_token",
      clientInformation: { client_id: "cid" },
      supportedAuthMethods: revocationAuthMethods(metadata()),
    });
    expect(headerOf(init, "Authorization")).toBeUndefined();
    expect(body(init).get("client_id")).toBe("cid");
  });
});

describe("aggregateOutcomes", () => {
  const failed = { status: "failed", detail: "boom" } as const;
  const revoked = {
    status: "revoked",
    tokenTypeHint: "refresh_token",
    endpoint: REVOKE_URL,
  } as const;
  const skipped = { status: "skipped", reason: "no_endpoint" } as const;

  // A grant still live at the authorization server is the thing worth
  // surfacing; another grant's success would silence it.
  it("reports a failure over a success", () => {
    expect(aggregateOutcomes([revoked, failed])).toEqual(failed);
  });

  it("reports a success over a skip", () => {
    expect(aggregateOutcomes([skipped, revoked])).toEqual(revoked);
  });

  it("falls through to the first outcome when none is decisive", () => {
    expect(aggregateOutcomes([skipped])).toEqual(skipped);
  });

  // `computeOutcome` returns early when there are no grants, so nothing else
  // reaches this — which is why it is tested here rather than left as a
  // function that returns `undefined` while typed otherwise.
  it("has an answer for an empty list", () => {
    expect(aggregateOutcomes([])).toEqual({
      status: "skipped",
      reason: "no_tokens",
    });
  });
});

describe("buildRevocationRequest", () => {
  it("posts a form-encoded token and hint", () => {
    const { url, init } = buildRevocationRequest({
      endpoint: REVOKE_URL,
      token: "r",
      tokenTypeHint: "refresh_token",
      supportedAuthMethods: [],
    });
    expect(url).toBe(REVOKE_URL);
    expect(init.method).toBe("POST");
    expect(headerOf(init, "Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(body(init).get("token")).toBe("r");
    expect(body(init).get("token_type_hint")).toBe("refresh_token");
  });

  it("sends a confidential client's secret in the Authorization header for client_secret_basic", () => {
    const { init } = buildRevocationRequest({
      endpoint: REVOKE_URL,
      token: "r",
      tokenTypeHint: "refresh_token",
      clientInformation: { client_id: "id one", client_secret: "s/ecret" },
      supportedAuthMethods: ["client_secret_basic"],
    });
    // RFC 6749 §2.3.1 form-urlencodes each half before the colon. That is what
    // keeps an id containing `:` unambiguous, and what stops `btoa` throwing on
    // a non-Latin-1 secret.
    expect(headerOf(init, "Authorization")).toBe(
      `Basic ${btoa("id%20one:s%2Fecret")}`,
    );
    expect(body(init).has("client_secret")).toBe(false);
  });

  // #2222 asked whether `encodeURIComponent` is safe here, since §2.3.1 names
  // the form-urlencoded algorithm (RFC 6749 Appendix B) and this is not it. It
  // is safe, and these cases are what say so: each credential is checked on the
  // wire *and* round-tripped through a real form-urldecoder, which is the
  // decoder a compliant authorization server runs. Before this, no case in
  // either suite could distinguish the two algorithms — the fixture decoded
  // with `decodeURIComponent`, the encoder's own inverse, so every input passed
  // by construction.
  describe.each([
    // The character the report turned on, and the answer to it:
    // `encodeURIComponent` escapes `+` as `%2B` rather than leaving it bare, so
    // a form-urldecoder never gets the chance to read it as a space. Base64
    // secrets contain `+` routinely, which is what makes this the case worth
    // pinning rather than reasoning about.
    { what: "a plus", id: "cid", secret: "ab+cd", wire: "cid:ab%2Bcd" },
    // A space is the one place the two algorithms visibly differ — `%20` here,
    // `+` under `URLSearchParams`. Both decode to a space at a compliant
    // server, and only `%20` also survives a server that decodes with
    // `decodeURIComponent` alone, which is why the encoder was left as it is.
    { what: "a space", id: "cid", secret: "ab cd", wire: "cid:ab%20cd" },
    // The case the original encoding change was made for: an unencoded `:` in
    // the id would move the separator and split the credential in the wrong
    // place. It must keep working.
    { what: "a colon", id: "c:id", secret: "sec", wire: "c%3Aid:sec" },
    // `%` is what makes a raw credential undecodable rather than merely
    // mis-decoded — an unescaped one starts an escape sequence that isn't.
    { what: "a percent", id: "cid", secret: "s%ec", wire: "cid:s%25ec" },
  ])("a credential containing $what", ({ id, secret, wire }) => {
    const basic = (): string => {
      const { init } = buildRevocationRequest({
        endpoint: REVOKE_URL,
        token: "r",
        tokenTypeHint: "refresh_token",
        clientInformation: { client_id: id, client_secret: secret },
        supportedAuthMethods: ["client_secret_basic"],
      });
      return String(headerOf(init, "Authorization")).slice("Basic ".length);
    };

    it("is percent-encoded on the wire", () => {
      expect(atob(basic())).toBe(wire);
    });

    it("survives a compliant server's form-urldecode", () => {
      const decoded = atob(basic());
      const separator = decoded.indexOf(":");
      // `+` to space *before* percent-decoding, exactly as `test-servers`'
      // `/oauth/revoke` now does. Written out here rather than imported so the
      // assertion does not lean on the fixture it exists to corroborate.
      const formUrlDecode = (v: string): string =>
        decodeURIComponent(v.replace(/\+/g, "%20"));
      expect(formUrlDecode(decoded.slice(0, separator))).toBe(id);
      expect(formUrlDecode(decoded.slice(separator + 1))).toBe(secret);
    });
  });

  it("sends the secret in the body for client_secret_post", () => {
    const { init } = buildRevocationRequest({
      endpoint: REVOKE_URL,
      token: "r",
      tokenTypeHint: "refresh_token",
      clientInformation: { client_id: "id", client_secret: "s" },
      supportedAuthMethods: ["client_secret_post"],
    });
    expect(headerOf(init, "Authorization")).toBeUndefined();
    expect(body(init).get("client_id")).toBe("id");
    expect(body(init).get("client_secret")).toBe("s");
  });

  it("identifies a public client by client_id alone", () => {
    const { init } = buildRevocationRequest({
      endpoint: REVOKE_URL,
      token: "a",
      tokenTypeHint: "access_token",
      clientInformation: { client_id: "public" },
      supportedAuthMethods: ["none"],
    });
    expect(headerOf(init, "Authorization")).toBeUndefined();
    expect(body(init).get("client_id")).toBe("public");
    expect(body(init).has("client_secret")).toBe(false);
  });
});

describe("revokeToken", () => {
  it("reports a 200 as revoked", async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );
    await expect(
      revokeToken({
        endpoint: REVOKE_URL,
        token: "r",
        tokenTypeHint: "refresh_token",
        supportedAuthMethods: [],
        fetchFn,
      }),
    ).resolves.toEqual({
      status: "revoked",
      tokenTypeHint: "refresh_token",
      endpoint: REVOKE_URL,
    });
  });

  it("reports a non-2xx as failed rather than throwing", async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () =>
        new Response(null, { status: 401, statusText: "Unauthorized" }),
    );
    const outcome = await revokeToken({
      endpoint: REVOKE_URL,
      token: "r",
      tokenTypeHint: "refresh_token",
      supportedAuthMethods: [],
      fetchFn,
    });
    expect(outcome).toMatchObject({ status: "failed", endpoint: REVOKE_URL });
    expect(outcome.status === "failed" ? outcome.detail : "").toContain("401");
  });

  // `String(err)` is the other half of the detail: a fetch double, or a runtime
  // that rejects with a non-Error, must still produce a readable message.
  it("reports a non-Error rejection as failed", async () => {
    const outcome = await revokeToken({
      endpoint: REVOKE_URL,
      token: "r",
      tokenTypeHint: "refresh_token",
      supportedAuthMethods: [],
      fetchFn: () => Promise.reject("plain string"),
    });
    expect(outcome).toEqual({
      status: "failed",
      endpoint: REVOKE_URL,
      detail: "plain string",
    });
  });

  // A lone UTF-16 surrogate is valid JSON, so it can reach here from a
  // persisted client id or secret and makes `encodeURIComponent` throw. Every
  // caller has already cleared its local state by the time this runs, so a
  // rejection here would break the documented best-effort guarantee.
  //
  // The stub is a real `Response` rather than a bare `vi.fn()`: an unencodable
  // credential must fail *before* the request goes out, and against a stub that
  // returns nothing the assertion would hold either way — reading `.ok` off
  // `undefined` throws into the same `catch`. Asserting the fetch was never
  // called is what makes this about the encoder (#2222).
  it("reports an unencodable credential as failed rather than throwing", async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );
    const outcome = await revokeToken({
      endpoint: REVOKE_URL,
      token: "r",
      tokenTypeHint: "refresh_token",
      clientInformation: {
        client_id: "cid",
        // Lone high surrogate.
        client_secret: `bad${String.fromCharCode(0xd800)}`,
      },
      supportedAuthMethods: ["client_secret_basic"],
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "failed", endpoint: REVOKE_URL });
  });

  it("reports a network failure as failed", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const outcome = await revokeToken({
      endpoint: REVOKE_URL,
      token: "r",
      tokenTypeHint: "refresh_token",
      supportedAuthMethods: [],
      fetchFn,
    });
    expect(outcome).toEqual({
      status: "failed",
      endpoint: REVOKE_URL,
      detail: "connect ECONNREFUSED",
    });
  });

  // The web fetch is `createRemoteFetch`, which re-issues the call as a POST to
  // `/api/fetch` and drops `init.signal`; the backend's outbound fetch gets no
  // signal either. A signal-only bound is therefore inert on exactly the path
  // the timeout exists for, so the deadline has to hold against a fetch that
  // ignores the signal entirely.
  it("gives up on a fetch that never settles and ignores the signal", async () => {
    const outcome = await revokeToken({
      endpoint: REVOKE_URL,
      token: "r",
      tokenTypeHint: "refresh_token",
      supportedAuthMethods: [],
      fetchFn: () => new Promise<Response>(() => {}),
      timeoutMs: 20,
    });
    expect(outcome).toMatchObject({ status: "failed", endpoint: REVOKE_URL });
    expect(outcome.status === "failed" ? outcome.detail : "").toContain(
      "timed out",
    );
  });

  // The teardown is already committed by the time this runs, so a wedged
  // authorization server must not be able to hold it open.
  it("bounds the request with an abort signal", async () => {
    let seen: RequestInit | undefined;
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      seen = init;
      return new Response(null, { status: 200 });
    });
    await revokeToken({
      endpoint: REVOKE_URL,
      token: "r",
      tokenTypeHint: "refresh_token",
      supportedAuthMethods: [],
      fetchFn,
      timeoutMs: 1,
    });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect(DEFAULT_REVOCATION_TIMEOUT_MS).toBeGreaterThan(0);
  });

  // What is left of a shared deadline is measured with a sub-millisecond clock,
  // so the budget handed down here is routinely fractional — and Node's
  // `AbortSignal.timeout` throws `ERR_OUT_OF_RANGE` on a non-integer delay,
  // before the fetch, turning a perfectly good request into a revocation failure
  // that never left the process (#2252).
  it("accepts a fractional budget and still sends the request", async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );
    const outcome = await revokeToken({
      endpoint: REVOKE_URL,
      token: "r",
      tokenTypeHint: "refresh_token",
      supportedAuthMethods: [],
      fetchFn,
      timeoutMs: 19.996,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ status: "revoked" });
  });
});

/**
 * Compose the two halves the way every caller does. The first one clears, so a
 * test that asserts on the store afterwards is looking at an emptied one — the
 * ordering guarantee itself is asserted separately below.
 */
async function revokeStoredOAuthTokens(params: {
  serverUrl: string;
  storage: BrowserOAuthStorage;
  fetchFn: typeof fetch;
  enabled?: boolean;
  timeoutMs?: number;
  logger?: InspectorLogger;
}): Promise<TokenRevocationOutcome> {
  const plan = await clearAndPlanRevocation({
    serverUrl: params.serverUrl,
    storage: params.storage,
    enabled: params.enabled,
  });
  return executeOAuthRevocation(plan, {
    fetchFn: params.fetchFn,
    timeoutMs: params.timeoutMs,
    logger: params.logger,
  });
}

/**
 * Stub the atomic take-and-clear with a hand-built snapshot. Needed wherever
 * the shape under test cannot be produced through the store's own API — a
 * legacy slot alongside an issuer slot, for instance, since an issuer-stamped
 * save promotes and clears the legacy one.
 */
function stubSnapshot(
  storage: BrowserOAuthStorage,
  snapshot: Partial<Parameters<typeof stubSnapshotShape>[0]> = {},
): void {
  vi.spyOn(storage, "takeRevocationSnapshot").mockResolvedValue(
    stubSnapshotShape(snapshot),
  );
}

function stubSnapshotShape(snapshot: {
  byIssuer?: Record<
    string,
    { tokens?: unknown; clientInformation?: unknown } | undefined
  >;
  legacyTokens?: unknown;
  legacyClientInformation?: unknown;
  preregisteredClientInformation?: unknown;
  serverMetadata?: unknown;
}): {
  byIssuer: Record<
    string,
    { tokens?: unknown; clientInformation?: unknown } | undefined
  >;
  legacyTokens?: unknown;
  legacyClientInformation?: unknown;
  preregisteredClientInformation?: unknown;
  serverMetadata?: unknown;
} {
  return { byIssuer: {}, ...snapshot };
}

describe("revokeStoredOAuthTokens (plan + execute)", () => {
  let storage: BrowserOAuthStorage;

  beforeEach(async () => {
    storage = new BrowserOAuthStorage();
    await storage.clear(SERVER_URL);
  });

  const ISSUER = "https://as.example.com";

  /**
   * A revocable grant: issuer-bound, and matching the cached metadata. Unkeyed
   * grants are deliberately NOT revocable (their authorization server is
   * unknown), so seeding one here would make every case below assert the
   * refusal instead of the behavior it is about.
   */
  async function seed(over: Partial<OAuthMetadata> = {}): Promise<void> {
    await storage.saveTokens(
      SERVER_URL,
      { access_token: "a", token_type: "Bearer", refresh_token: "r" },
      { issuer: ISSUER },
    );
    await storage.saveServerMetadata(SERVER_URL, metadata(over));
  }

  it("revokes the stored refresh token", async () => {
    await seed();
    await storage.saveClientInformation(
      SERVER_URL,
      { client_id: "cid", client_secret: "sec" },
      { registrationKind: "dcr" },
    );

    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );

    const outcome = await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn,
    });

    expect(outcome).toMatchObject({ status: "revoked" });
    const [, init] = fetchFn.mock.calls[0]!;
    expect(body(init!).get("token")).toBe("r");
  });

  // A grant minted under DCR must be revoked with the registration that minted
  // it, even after the server has since been switched to a configured
  // `oauth.clientId`. RFC 7009 §2.2 answers 200 for a token the server does not
  // recognise as the caller's, so using the wrong client reports `revoked`
  // while the grant stays live — and the local record is already gone.
  it("authenticates with the registration bound to the grant's issuer", async () => {
    await seed();
    await storage.saveClientInformation(
      SERVER_URL,
      { client_id: "dcr-cid", client_secret: "dcr-sec" },
      { registrationKind: "dcr", issuer: ISSUER },
    );
    // A configured client id was added later; it must NOT win here.
    await storage.savePreregisteredClientInformation(SERVER_URL, {
      client_id: "static-cid",
      client_secret: "static-sec",
    });
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );

    await revokeStoredOAuthTokens({ serverUrl: SERVER_URL, storage, fetchFn });

    const [, init] = fetchFn.mock.calls[0]!;
    expect(headerOf(init!, "Authorization")).toBe(
      `Basic ${btoa("dcr-cid:dcr-sec")}`,
    );
  });

  // The other direction: a token minted with the configured client leaves the
  // issuer slot empty (the SDK writes it only after DCR), so the preregistered
  // entry is the right fallback — and dropping it would send no client
  // authentication at all for exactly the confidential clients most likely to
  // require it.
  it("falls back to a preconfigured client when the issuer slot has none", async () => {
    await seed();
    await storage.savePreregisteredClientInformation(SERVER_URL, {
      client_id: "static-cid",
      client_secret: "static-sec",
    });
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );

    await revokeStoredOAuthTokens({ serverUrl: SERVER_URL, storage, fetchFn });

    const [, init] = fetchFn.mock.calls[0]!;
    expect(headerOf(init!, "Authorization")).toBe(
      `Basic ${btoa("static-cid:static-sec")}`,
    );
  });

  // `clear(serverUrl)` drops EVERY `byIssuer` slot, so reading only the active
  // issuer's token would leave the earlier authorization server's grant live
  // while destroying the local record of it — the same leak this feature
  // closes, one level down (SEP-2352 keeps credentials per issuer).
  it("revokes every issuer-bound grant, not just the active one", async () => {
    const issuerMetadata = metadata({ issuer: "https://as.example.com" });
    await storage.saveServerMetadata(SERVER_URL, issuerMetadata);
    await storage.saveTokens(
      SERVER_URL,
      { access_token: "a1", token_type: "Bearer", refresh_token: "r1" },
      { issuer: "https://as.example.com" },
    );
    await storage.saveTokens(
      SERVER_URL,
      { access_token: "a2", token_type: "Bearer", refresh_token: "r2" },
      { issuer: "https://as.example.com" },
    );
    // A second slot under the SAME issuer would be one grant; use two distinct
    // tokens under one issuer plus the ctx-less read to prove dedup instead.
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );

    await revokeStoredOAuthTokens({ serverUrl: SERVER_URL, storage, fetchFn });

    // One issuer, one grant — the ctx-less read is the same token and is deduped.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(
      new URLSearchParams(String(fetchFn.mock.calls[0]![1]!.body)).get("token"),
    ).toBe("r2");
  });

  // `getTokens(url, issuer)` falls back to the legacy unkeyed slot when that
  // issuer holds none. Treating the fallback as the issuer's would label an
  // old, unbound token with a newly discovered authorization server and send it
  // there — so an enumerated issuer is read EXACTLY.
  it("does not attribute the legacy unkeyed token to an enumerated issuer", async () => {
    await storage.saveServerMetadata(
      SERVER_URL,
      metadata({ issuer: "https://as.example.com" }),
    );
    // A legacy, unbound grant...
    await storage.saveTokens(SERVER_URL, {
      access_token: "legacy-a",
      token_type: "Bearer",
      refresh_token: "legacy-r",
    });
    // ...and an issuer slot carrying only client information, which is the
    // shape a partially-migrated flow leaves behind.
    await storage.saveClientInformation(
      SERVER_URL,
      { client_id: "cid" },
      { registrationKind: "dcr", issuer: "https://as.example.com" },
    );

    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );
    const outcome = await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn,
    });

    // Nothing is sent: the only grant here is the legacy one, whose
    // authorization server is unknown. The point is that it is never presented
    // as the enumerated issuer's — one request with `legacy-r` would be exactly
    // that mistake.
    expect(fetchFn).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.status === "failed" ? outcome.detail : "").toContain(
      "predates issuer binding",
    );
  });

  // The active issuer slot can hold client information without a token, in
  // which case the ctx-less read falls back to the LEGACY grant — a distinct
  // grant, even if some other issuer happens to hold the same opaque value.
  // Suppressing on the value would drop it unrevoked and unreported, which is
  // why the suppression keys off the store's issuer stamp instead.
  it("keeps the legacy grant when another issuer holds the same token value", async () => {
    // Hand-built: an issuer-stamped save promotes and clears the legacy slot,
    // so the store's own API cannot produce both at once.
    stubSnapshot(storage, {
      byIssuer: {
        "https://as-a.example.com": {
          tokens: {
            access_token: "shared",
            token_type: "Bearer",
            refresh_token: "shared-r",
          },
        },
      },
      legacyTokens: {
        access_token: "shared",
        token_type: "Bearer",
        refresh_token: "shared-r",
      },
      serverMetadata: {
        issuer: "https://as-a.example.com",
        authorization_endpoint: "https://as-a.example.com/authorize",
        token_endpoint: "https://as-a.example.com/token",
        revocation_endpoint: REVOKE_URL,
        response_types_supported: ["code"],
      },
    });
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );

    const outcome = await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn,
    });

    // Two GRANTS despite one token value. The issuer-bound one is revoked; the
    // legacy one is refused (unknown authorization server) and reported, rather
    // than being silently collapsed into the other by a token-value dedup.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.status === "failed" ? outcome.detail : "").toContain(
      "predates issuer binding",
    );
  });

  // Absence establishes nothing: a metadata document with no `issuer` cannot
  // show that its revocation endpoint belongs to the grant's authorization
  // server, so sending the token anyway would disclose a bearer credential to
  // a server that may never have minted it.
  it("refuses an issuer-bound grant when the cached metadata names no issuer", async () => {
    await storage.saveServerMetadata(
      SERVER_URL,
      metadata({ issuer: undefined }),
    );
    await storage.saveTokens(
      SERVER_URL,
      { access_token: "a", token_type: "Bearer", refresh_token: "r" },
      { issuer: "https://as-a.example.com" },
    );
    const fetchFn = vi.fn<typeof fetch>();

    const outcome = await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.status === "failed" ? outcome.detail : "").toContain(
      "names no issuer",
    );
  });

  // "Unkeyed" means the authorization server is UNKNOWN, not that the cached
  // endpoint is proven to own the grant — server metadata is a single slot a
  // later discovery overwrites, while a legacy token survives until the first
  // issuer-stamped save. Refusing costs such an entry its revocation, which is
  // the behavior it had before this feature existed, and it earns it back on
  // the next authorization.
  it("refuses a legacy grant, whose authorization server is unknown", async () => {
    await storage.saveServerMetadata(
      SERVER_URL,
      metadata({ issuer: "https://as.example.com" }),
    );
    await storage.saveTokens(SERVER_URL, {
      access_token: "a",
      token_type: "Bearer",
      refresh_token: "r",
    });
    const fetchFn = vi.fn<typeof fetch>();

    const outcome = await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.status === "failed" ? outcome.detail : "").toContain(
      "re-authorize",
    );
  });

  // The take-and-clear is one step, so its failure means the state is still
  // there. That has to REJECT rather than report: every caller's contract is
  // "the clear happened", and a `failed` outcome would say the opposite of what
  // occurred. Both clients have a rejection path for exactly this.
  it("rejects when the atomic take-and-clear itself fails", async () => {
    vi.spyOn(storage, "takeRevocationSnapshot").mockRejectedValue(
      new Error("store unwritable"),
    );

    await expect(
      revokeStoredOAuthTokens({
        serverUrl: SERVER_URL,
        storage,
        fetchFn: vi.fn<typeof fetch>(),
      }),
    ).rejects.toThrow("store unwritable");
  });

  // The timeout is a budget for the WHOLE teardown, not per request. `clear`
  // deletes every issuer slot, so a per-request bound would let a server with
  // N of them block the disconnect for N × the timeout — at which point the
  // "short timeout" bounds a single request and nothing the user feels.
  it("shares one deadline across grants instead of one per grant", async () => {
    // Built directly rather than through the store: three *revocable* grants
    // means three tokens under one issuer, which `byIssuer` cannot hold (one
    // slot per issuer). The budget logic is what is under test here, and a plan
    // is a plain value.
    const grant = (n: string) => ({
      issuer: "https://as.example.com",
      token: `r-${n}`,
      tokenTypeHint: "refresh_token" as const,
    });
    // Every request hangs, so the first burns the whole budget.
    const fetchFn = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));

    const started = Date.now();
    const outcome = await executeOAuthRevocation(
      {
        serverUrl: SERVER_URL,
        grants: [grant("a"), grant("b"), grant("c")],
        failures: [],
        endpoint: REVOKE_URL,
        supportedAuthMethods: [],
        metadataIssuer: "https://as.example.com",
      },
      { fetchFn, timeoutMs: 30 },
    );
    const elapsed = Date.now() - started;

    expect(outcome).toMatchObject({ status: "failed" });
    // With a per-grant bound this would be ~90ms. Generous upper bound so the
    // assertion is about the shape, not the machine.
    expect(elapsed).toBeLessThan(70);
    // The first burned the budget; the rest are reported as never attempted.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  // The boundary the shared budget used to be decided on was `remainingMs > 0`,
  // which timer resolution can land either side of: a grant that finished a
  // hair before the deadline left a fractional budget behind, and the next grant
  // spent it on a request that could not possibly complete (#2252). The floor
  // makes that decision the same on every run.
  it("does not issue a request with less than the minimum budget left", async () => {
    const grant = (n: string) => ({
      issuer: "https://as.example.com",
      token: `r-${n}`,
      tokenTypeHint: "refresh_token" as const,
    });
    const timeoutMs = 40;
    // Lands the second grant inside the floor but *above* zero — the sliver the
    // old bound would have spent. A slow machine only pushes the remainder
    // further below the floor, so the assertion cannot flip the other way.
    const firstRequestMs = timeoutMs - MIN_REVOCATION_REQUEST_BUDGET_MS + 1;
    const fetchFn = vi.fn<typeof fetch>(async () => {
      await new Promise((resolve) => setTimeout(resolve, firstRequestMs));
      return new Response(null, { status: 200 });
    });

    const outcome = await executeOAuthRevocation(
      {
        serverUrl: SERVER_URL,
        grants: [grant("a"), grant("b")],
        failures: [],
        endpoint: REVOKE_URL,
        supportedAuthMethods: [],
        metadataIssuer: "https://as.example.com",
      },
      { fetchFn, timeoutMs },
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    // The unattempted grant outranks the first one's success, so the caller
    // hears that a grant may still be live rather than that all was well.
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.status === "failed" ? outcome.detail : "").toContain(
      "budget was exhausted",
    );
  });

  // A grant bound to an issuer the cached metadata does not describe cannot be
  // revoked — that endpoint belongs to a different authorization server, and
  // sending it another AS's token would hand a credential to a server that
  // never minted it. Saying so is the point: the grant is being dropped.
  it("reports a grant whose issuer the cached metadata does not describe", async () => {
    await storage.saveServerMetadata(
      SERVER_URL,
      metadata({ issuer: "https://as-b.example.com" }),
    );
    await storage.saveTokens(
      SERVER_URL,
      { access_token: "a", token_type: "Bearer", refresh_token: "r-a" },
      { issuer: "https://as-a.example.com" },
    );
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );

    const outcome = await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.status === "failed" ? outcome.detail : "").toContain(
      "as-a.example.com",
    );
  });

  // A failure on one grant must not be hidden behind another's success — a
  // grant still live at the authorization server is the thing worth surfacing.
  it("reports a failure over another grant's success", async () => {
    await storage.saveServerMetadata(
      SERVER_URL,
      metadata({ issuer: "https://as-b.example.com" }),
    );
    // Revocable: bound to the issuer the metadata describes.
    await storage.saveTokens(
      SERVER_URL,
      { access_token: "b", token_type: "Bearer", refresh_token: "r-b" },
      { issuer: "https://as-b.example.com" },
    );
    // Not revocable: bound to an issuer the cached metadata is not for.
    await storage.saveTokens(
      SERVER_URL,
      { access_token: "a", token_type: "Bearer", refresh_token: "r-a" },
      { issuer: "https://as-a.example.com" },
    );
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );

    const outcome = await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ status: "failed" });
  });

  // The whole point of keeping this path opt-out-able: an authorization server
  // with no RFC 7009 support must behave exactly as it did before the feature.
  it("does nothing when the authorization server advertises no revocation endpoint", async () => {
    await seed({ revocation_endpoint: undefined });
    const fetchFn = vi.fn<typeof fetch>();
    await expect(
      revokeStoredOAuthTokens({ serverUrl: SERVER_URL, storage, fetchFn }),
    ).resolves.toEqual({ status: "skipped", reason: "no_endpoint" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does nothing when no metadata was ever discovered", async () => {
    await storage.saveTokens(SERVER_URL, {
      access_token: "a",
      token_type: "Bearer",
    });
    const fetchFn = vi.fn<typeof fetch>();
    await expect(
      revokeStoredOAuthTokens({ serverUrl: SERVER_URL, storage, fetchFn }),
    ).resolves.toEqual({ status: "skipped", reason: "no_metadata" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does nothing when there is no stored grant", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(
      revokeStoredOAuthTokens({ serverUrl: SERVER_URL, storage, fetchFn }),
    ).resolves.toEqual({ status: "skipped", reason: "no_tokens" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("skips the request when disabled", async () => {
    await seed();
    const fetchFn = vi.fn<typeof fetch>();
    await expect(
      revokeStoredOAuthTokens({
        serverUrl: SERVER_URL,
        storage,
        fetchFn,
        enabled: false,
      }),
    ).resolves.toEqual({ status: "skipped", reason: "disabled" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("warns and reports rather than throwing when the request fails", async () => {
    await seed();
    const logger = fakeLogger();
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 500, statusText: "Boom" }),
    );

    const outcome = await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn,
      logger,
    });

    expect(outcome.status).toBe("failed");
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("logs the no-endpoint case at debug", async () => {
    await seed({ revocation_endpoint: undefined });
    const logger = fakeLogger();
    await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn: vi.fn<typeof fetch>(),
      logger,
    });
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  // A snapshot the code cannot interpret is reported, not thrown: the state is
  // already gone by then, so there is nothing left for the caller to retry.
  // (A failure of the take-and-clear ITSELF rejects instead — see above.)
  it("reports an uninterpretable snapshot as failed", async () => {
    stubSnapshot(storage, {
      byIssuer: {
        // Not a valid `OAuthTokens` — no `token_type`.
        "https://as.example.com": { tokens: { access_token: 42 } },
      },
      serverMetadata: {
        issuer: "https://as.example.com",
        authorization_endpoint: "https://as.example.com/authorize",
        token_endpoint: "https://as.example.com/token",
        revocation_endpoint: REVOKE_URL,
        response_types_supported: ["code"],
      },
    });

    const outcome = await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn: vi.fn<typeof fetch>(),
    });
    expect(outcome).toMatchObject({ status: "failed" });
  });

  // The preconfigured registration is only a *fallback*, so a malformed one
  // must not abort grants that carry their own valid credentials.
  it("still revokes when the preconfigured client registration is malformed", async () => {
    stubSnapshot(storage, {
      byIssuer: {
        "https://as.example.com": {
          tokens: {
            access_token: "a",
            token_type: "Bearer",
            refresh_token: "r-good",
          },
          clientInformation: { client_id: "dcr-cid" },
        },
      },
      // Not a valid `OAuthClientInformation` — no `client_id`.
      preregisteredClientInformation: { client_secret: "orphan" },
      serverMetadata: {
        issuer: "https://as.example.com",
        authorization_endpoint: "https://as.example.com/authorize",
        token_endpoint: "https://as.example.com/token",
        revocation_endpoint: REVOKE_URL,
        response_types_supported: ["code"],
      },
    });
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );

    const outcome = await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn,
    });

    // The grant was still revoked, with its OWN registration...
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(
      new URLSearchParams(String(fetchFn.mock.calls[0]![1]!.body)).get(
        "client_id",
      ),
    ).toBe("dcr-cid");
    // ...and the malformed fallback is reported rather than swallowed.
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.status === "failed" ? outcome.detail : "").toContain(
      "preconfigured client registration",
    );
  });

  // A corrupt slot must not abandon the grants that are still revocable — the
  // state is gone either way, so the failure has to be reported BESIDE the
  // successes rather than instead of them.
  it("still revokes the readable grants when one slot cannot be parsed", async () => {
    stubSnapshot(storage, {
      byIssuer: {
        "https://as.example.com": {
          tokens: {
            access_token: "a",
            token_type: "Bearer",
            refresh_token: "r-good",
          },
        },
        // Unparseable: no `token_type`.
        "https://broken.example.com": { tokens: { access_token: 42 } },
      },
      serverMetadata: {
        issuer: "https://as.example.com",
        authorization_endpoint: "https://as.example.com/authorize",
        token_endpoint: "https://as.example.com/token",
        revocation_endpoint: REVOKE_URL,
        response_types_supported: ["code"],
      },
    });
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );

    const outcome = await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn,
    });

    // The good grant was still revoked...
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(
      new URLSearchParams(String(fetchFn.mock.calls[0]![1]!.body)).get("token"),
    ).toBe("r-good");
    // ...and the unreadable slot is reported rather than swallowed.
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.status === "failed" ? outcome.detail : "").toContain(
      "could not read the stored grant",
    );
  });

  // A token is only meaningful to the AS that minted it, so two issuers minting
  // the same opaque string are two grants. Collapsing them would drop the
  // second before the issuer-mismatch check could even report it.
  it("does not collapse two issuers that minted the same token value", async () => {
    await storage.saveServerMetadata(
      SERVER_URL,
      metadata({ issuer: "https://as-a.example.com" }),
    );
    for (const issuer of [
      "https://as-a.example.com",
      "https://as-b.example.com",
    ]) {
      await storage.saveTokens(
        SERVER_URL,
        { access_token: "same", token_type: "Bearer", refresh_token: "same-r" },
        { issuer },
      );
    }
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );

    const outcome = await revokeStoredOAuthTokens({
      serverUrl: SERVER_URL,
      storage,
      fetchFn,
    });

    // Only as-a matches the cached metadata, so only it is revocable — but
    // as-b is REPORTED rather than silently dropped, which is what collapsing
    // by token alone would have done.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.status === "failed" ? outcome.detail : "").toContain(
      "as-b.example.com",
    );
  });
});

// The reason the API is two halves rather than one call (#2144, review round
// 13). Revoking first and clearing afterwards delays the clear by however long
// the network takes, and a FRESH authorization completing in that window is
// then deleted by a clear reasoning about the grant it replaced.
describe("plan / clear / execute ordering", () => {
  let storage: BrowserOAuthStorage;

  beforeEach(async () => {
    storage = new BrowserOAuthStorage();
    await storage.clear(SERVER_URL);
    await storage.saveServerMetadata(
      SERVER_URL,
      metadata({ issuer: "https://as.example.com" }),
    );
    await storage.saveTokens(
      SERVER_URL,
      { access_token: "old", token_type: "Bearer", refresh_token: "old-r" },
      { issuer: "https://as.example.com" },
    );
  });

  it("does not delete a grant written while the request is in flight", async () => {
    let releaseRequest: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const fetchFn = vi.fn<typeof fetch>(async () => {
      await inFlight;
      return new Response(null, { status: 200 });
    });

    // The caller's real sequence: take-and-clear atomically, then send.
    const plan = await clearAndPlanRevocation({
      serverUrl: SERVER_URL,
      storage,
    });
    const sending = executeOAuthRevocation(plan, { fetchFn });

    // A fresh authorization lands while the request is still out.
    await storage.saveTokens(
      SERVER_URL,
      { access_token: "new", token_type: "Bearer", refresh_token: "new-r" },
      { issuer: "https://as.example.com" },
    );

    releaseRequest();
    await sending;

    // The new grant survived, and the OLD token is what was revoked.
    expect((await storage.getTokens(SERVER_URL))?.access_token).toBe("new");
    expect(
      new URLSearchParams(String(fetchFn.mock.calls[0]![1]!.body)).get("token"),
    ).toBe("old-r");
  });

  it("sends the snapshot even though the store was emptied first", async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );

    const plan = await clearAndPlanRevocation({
      serverUrl: SERVER_URL,
      storage,
    });
    expect(await storage.getTokens(SERVER_URL)).toBeUndefined();

    await expect(
      executeOAuthRevocation(plan, { fetchFn }),
    ).resolves.toMatchObject({ status: "revoked" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("plans nothing when revocation is disabled", async () => {
    const plan = await clearAndPlanRevocation({
      serverUrl: SERVER_URL,
      storage,
      enabled: false,
    });
    const fetchFn = vi.fn<typeof fetch>();

    expect(plan.grants).toHaveLength(0);
    await expect(executeOAuthRevocation(plan, { fetchFn })).resolves.toEqual({
      status: "skipped",
      reason: "disabled",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
