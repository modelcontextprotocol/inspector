import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  withOAuthRequestTimeout,
  OAuthRequestTimeoutError,
} from "@inspector/core/auth/requestTimeout.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createEchoTool,
  loadConfig,
  resolveConfig,
  STALLABLE_OAUTH_ENDPOINTS,
  type StallableOAuthEndpoint,
} from "@modelcontextprotocol/inspector-test-server";

/**
 * The OAuth-path request timeouts (#2319), driven against a **real, established,
 * idle socket** rather than a `fetch` stub (#2382).
 *
 * #2319 put an `AbortSignal.timeout` on five OAuth calls that previously went
 * out with no signal at all. Every test of that work injected a stubbed
 * `fetchFn`, which settles on the *client* side — so the state the issue
 * actually describes was never reproduced:
 *
 * > a stall is invisible in browser devtools […] while a Node-side socket sat
 * > established and idle.
 *
 * These tests use the `oauth.stallEndpoints` fixture capability to accept the
 * request and withhold the response, so the deadline is the only thing that can
 * end the call. A regression that dropped the wrapper would hang here until the
 * suite's own budget killed it, rather than passing against an obliging stub.
 */
const configsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../test-servers/configs",
);

/** Comfortably under the suite budget, comfortably over a LAN round trip. */
const BUDGET_MS = 1_500;

/** How each endpoint is requested, so every advertised name is really driven. */
const ENDPOINTS: Record<
  StallableOAuthEndpoint,
  { pathname: string; init: RequestInit; query?: Record<string, string> }
> = {
  "protected-resource-metadata": {
    pathname: "/.well-known/oauth-protected-resource",
    init: { method: "GET" },
  },
  "as-metadata": {
    pathname: "/.well-known/oauth-authorization-server",
    init: { method: "GET" },
  },
  authorize: {
    pathname: "/oauth/authorize",
    init: { method: "GET" },
    // The one endpoint always called WITH a query string — which is what makes
    // the middleware's `req.path` match load-bearing. Matching `req.url`
    // instead passes every other case in this file and fails only here.
    query: {
      client_id: "test-client",
      response_type: "code",
      redirect_uri: "http://127.0.0.1:6274/oauth/callback",
    },
  },
  token: {
    pathname: "/oauth/token",
    init: {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&code=irrelevant",
    },
  },
  revoke: {
    pathname: "/oauth/revoke",
    init: {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "token=irrelevant",
    },
  },
  register: {
    pathname: "/oauth/register",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://127.0.0.1:6274/cb"] }),
    },
  },
};

/** Wait for `predicate`, rather than sleeping and hoping. */
async function until(
  predicate: () => boolean,
  what: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("OAuth request timeouts against a stalled endpoint (#2382)", () => {
  let server: TestServerHttp | null = null;

  afterEach(async () => {
    if (server) {
      try {
        await server.stop();
      } catch {
        // ignore
      }
      server = null;
    }
  });

  function urlFor(base: string, endpoint: StallableOAuthEndpoint): string {
    const { pathname, query } = ENDPOINTS[endpoint];
    const url = new URL(pathname, base);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.href;
  }

  async function startStalling(
    endpoints: StallableOAuthEndpoint[],
    extra: { stallMs?: number } = {},
  ): Promise<TestServerHttp> {
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("oauth-stall", "1.0.0"),
      tools: [createEchoTool()],
      oauth: {
        enabled: true,
        mode: "combined",
        requireAuth: true,
        scopesSupported: ["mcp"],
        supportDCR: true,
        stallEndpoints: endpoints,
        ...extra,
      },
    });
    await started.start();
    server = started;
    return started;
  }

  // ⚠️ Every advertised endpoint, not a sample. `stallTargetsFor` hardcodes a
  // path and a method set per endpoint, so a typo in any entry produces a
  // fixture that quietly answers normally — the precise failure this option
  // exists to prevent, and one no other test would catch (Copilot).
  for (const endpoint of STALLABLE_OAUTH_ENDPOINTS) {
    it(`stalls the ${endpoint} endpoint until the deadline fires`, async () => {
      const started = await startStalling([endpoint]);
      const url = urlFor(started.url, endpoint);
      const timedFetch = withOAuthRequestTimeout(fetch, BUDGET_MS);
      const startedAt = Date.now();

      await expect(timedFetch(url, ENDPOINTS[endpoint].init)).rejects.toThrow(
        OAuthRequestTimeoutError,
      );

      // The deadline ended it, not an instant connection failure: a refused
      // port rejects in single-digit ms and would satisfy a bare
      // `rejects.toThrow` while proving nothing about the timer.
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(BUDGET_MS - 100);
    });

    it(`names the ${endpoint} endpoint and the budget it gave up on`, async () => {
      const started = await startStalling([endpoint]);
      const url = urlFor(started.url, endpoint);
      const timedFetch = withOAuthRequestTimeout(fetch, BUDGET_MS);

      await expect(
        timedFetch(url, ENDPOINTS[endpoint].init),
      ).rejects.toMatchObject({
        timeoutMs: BUDGET_MS,
        url: expect.stringContaining(ENDPOINTS[endpoint].pathname),
      });
    });
  }

  it("stalls only the selected endpoint, leaving the others answering", async () => {
    // The control. A fixture that stalled everything would make every test
    // above pass while telling us nothing about which call was bounded.
    const started = await startStalling(["token"]);
    const metadata = await fetch(
      urlFor(started.url, "protected-resource-metadata"),
    );

    expect(metadata.ok).toBe(true);
    await expect(metadata.json()).resolves.toMatchObject({
      authorization_servers: expect.any(Array),
    });
  });

  it("distinguishes two calls that share a path by their method", async () => {
    // ⚠️ Both configurable document paths are caller-supplied, so a config may
    // point one at a path another endpoint already serves. Keyed on path alone,
    // stalling `token` would also stall this GET (Copilot).
    const started = await startStalling(["token"]);
    const collided = new URL("/oauth/token", started.url).href;

    // The token POST is stalled…
    await expect(
      withOAuthRequestTimeout(fetch, BUDGET_MS)(collided, ENDPOINTS.token.init),
    ).rejects.toThrow(OAuthRequestTimeoutError);

    // …while a GET to the very same path is not held by the stall middleware.
    // Which status it gets does not matter; that a response arrives at all does.
    const samePathGet = await fetch(collided, { method: "GET" });
    expect(typeof samePathGet.status).toBe("number");
  });

  it("answers late rather than never when stallMs is positive", async () => {
    // `stallMs` is advertised and was previously untested: every fixture used
    // 0, so the `setTimeout(() => next())` branch could regress unseen
    // (Copilot).
    const delayMs = 600;
    const started = await startStalling(["protected-resource-metadata"], {
      stallMs: delayMs,
    });
    const startedAt = Date.now();

    const res = await fetch(urlFor(started.url, "protected-resource-metadata"));
    const elapsed = Date.now() - startedAt;

    expect(res.ok).toBe(true);
    // Late, but it did arrive — both halves matter.
    expect(elapsed).toBeGreaterThanOrEqual(delayMs - 50);
    await expect(res.json()).resolves.toMatchObject({
      authorization_servers: expect.any(Array),
    });
  });

  it("times out when the caller's budget is shorter than stallMs", async () => {
    const started = await startStalling(["token"], { stallMs: 5_000 });
    const timedFetch = withOAuthRequestTimeout(fetch, 400);

    await expect(
      timedFetch(urlFor(started.url, "token"), ENDPOINTS.token.init),
    ).rejects.toThrow(OAuthRequestTimeoutError);
  });

  it("releases the delay timer when the client aborts first", async () => {
    // The timer cleanup on the `stallMs` path. Left armed, a stalled fixture
    // would keep the event loop alive past the test that used it (Copilot).
    const started = await startStalling(["token"], { stallMs: 10_000 });
    const controller = new AbortController();

    const pending = fetch(urlFor(started.url, "token"), {
      ...ENDPOINTS.token.init,
      signal: controller.signal,
    }).catch(() => "aborted");

    await until(
      () => started.stalledRequestCount() >= 1,
      "the request to be parked",
    );
    controller.abort();

    await expect(pending).resolves.toBe("aborted");
    // The release ran, so the fixture is not still holding it.
    await until(
      () => started.stalledRequestCount() === 0,
      "the stall to be released",
    );
  });

  it("rejects an unknown stallEndpoints entry instead of answering normally", async () => {
    // A typo must fail loudly. Ignored, it would produce a fixture that answers
    // promptly, and a timeout test written against it would fail pointing at
    // the timeout rather than at the config.
    //
    // The throw lands on `start()`, not on the constructor: routes — and so the
    // middleware — are built when the server is started. Asserting on the
    // constructor would pass for the wrong reason, since it validates nothing.
    const typo = createTestServerHttp({
      serverInfo: createTestServerInfo("oauth-stall-typo", "1.0.0"),
      tools: [createEchoTool()],
      oauth: {
        enabled: true,
        mode: "combined",
        // @ts-expect-error - deliberately not a StallableOAuthEndpoint
        stallEndpoints: ["tokens"],
      },
    });

    await expect(typo.start()).rejects.toThrow(
      /Unknown oauth\.stallEndpoints entry.*"tokens"/s,
    );
    // It must also name what WAS valid, or the fixture author is left guessing.
    await expect(typo.start()).rejects.toThrow(/Expected one of:.*token/s);

    try {
      await typo.stop();
    } catch {
      // never started; nothing to stop
    }
  });

  it("stops cleanly with a withheld response still in flight", async () => {
    // ⚠️ The property that makes this fixture usable at all. A withheld
    // response holds an established socket, and `stop()` relies on
    // `httpServer.closeAllConnections?.()` to destroy it. Without that, every
    // suite touching this fixture would hang at teardown instead of failing —
    // and it would hang in `afterEach`, pointing at the wrong test.
    const started = await startStalling(["token"]);

    // Deliberately unawaited and unbounded: the point is that a request with no
    // deadline of its own is in flight when the server goes down.
    const pending = fetch(urlFor(started.url, "token"), {
      ...ENDPOINTS.token.init,
    }).catch(() => "socket destroyed");

    // ⚠️ Wait for the request to be ACCEPTED AND PARKED, never a fixed sleep.
    // A sleep that lost the race would stop the server before the request
    // arrived; the fetch would then reject because the server closed, and this
    // test would pass without ever exercising `closeAllConnections()` on an
    // established request (Copilot).
    await until(
      () => started.stalledRequestCount() >= 1,
      "the request to be parked",
    );

    await expect(started.stop()).resolves.toBeUndefined();
    server = null;

    await expect(pending).resolves.toBe("socket destroyed");
  });

  it("drives the two checked-in showcase configs, not just inline ones", async () => {
    // The JSON-to-ServerConfig mapping is its own failure surface: a misspelled
    // key in either file, or a `resolveConfig` that stopped threading
    // `stallEndpoints`, would leave the documented manual fixtures quietly
    // permissive while every inline test above stayed green.
    for (const file of [
      "oauth-stalled-token-http.json",
      "oauth-stalled-discovery-http.json",
    ]) {
      const resolved = resolveConfig(loadConfig(path.join(configsDir, file)));
      const started = createTestServerHttp(resolved);
      await started.start();
      server = started;

      const endpoint: StallableOAuthEndpoint = file.includes("token")
        ? "token"
        : "protected-resource-metadata";
      const timedFetch = withOAuthRequestTimeout(fetch, BUDGET_MS);

      await expect(
        timedFetch(urlFor(started.url, endpoint), ENDPOINTS[endpoint].init),
      ).rejects.toThrow(OAuthRequestTimeoutError);

      await started.stop();
      server = null;
    }
  });
});
