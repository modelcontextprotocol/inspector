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

const CONFIGS = [
  {
    file: "oauth-stalled-token-http.json",
    endpoint: "token",
    /** Built from the server's own bound URL — never an assumed port. */
    pathname: "/oauth/token",
    init: {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&code=irrelevant",
    } satisfies RequestInit,
  },
  {
    file: "oauth-stalled-discovery-http.json",
    endpoint: "protected-resource-metadata",
    pathname: "/.well-known/oauth-protected-resource",
    init: { method: "GET" } satisfies RequestInit,
  },
];

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

  async function startFromConfig(file: string): Promise<TestServerHttp> {
    const resolved = resolveConfig(loadConfig(path.join(configsDir, file)));
    const started = createTestServerHttp(resolved);
    await started.start();
    server = started;
    return started;
  }

  for (const { file, endpoint, pathname, init } of CONFIGS) {
    it(`times out on the stalled ${endpoint} endpoint rather than hanging`, async () => {
      const started = await startFromConfig(file);
      const url = new URL(pathname, started.url).href;

      const timedFetch = withOAuthRequestTimeout(fetch, BUDGET_MS);
      const started_at = Date.now();

      await expect(timedFetch(url, init)).rejects.toThrow(
        OAuthRequestTimeoutError,
      );

      // The deadline is what ended it, not an instant connection failure: a
      // refused port would reject in single-digit milliseconds and would pass a
      // bare `rejects.toThrow` while proving nothing about the timer.
      const elapsed = Date.now() - started_at;
      expect(elapsed).toBeGreaterThanOrEqual(BUDGET_MS - 100);
    });

    it(`reports the budget and the endpoint it gave up on for ${endpoint}`, async () => {
      const started = await startFromConfig(file);
      const url = new URL(pathname, started.url).href;
      const timedFetch = withOAuthRequestTimeout(fetch, BUDGET_MS);

      // The error has to name *which* call gave up — that is the distinction
      // the five separate timeouts exist to make, and the reason the fixture
      // stalls per endpoint rather than globally.
      await expect(timedFetch(url, init)).rejects.toMatchObject({
        timeoutMs: BUDGET_MS,
        url: expect.stringContaining(pathname),
      });
    });
  }

  it("leaves every other endpoint answering promptly", async () => {
    // The control. A fixture that stalled everything would make the tests above
    // pass while telling us nothing about which call the deadline bounded.
    const started = await startFromConfig("oauth-stalled-token-http.json");
    const metadata = await fetch(
      new URL("/.well-known/oauth-protected-resource", started.url).href,
    );

    expect(metadata.ok).toBe(true);
    await expect(metadata.json()).resolves.toMatchObject({
      authorization_servers: expect.any(Array),
    });
  });

  it("stalls an endpoint that is always called WITH a query string", async () => {
    // ⚠️ This is what makes the `req.path` match load-bearing. Every other
    // stallable endpoint is requested at a bare path, so a middleware matching
    // on `req.url` — which carries `?client_id=…` — passes all of them and
    // silently stops matching only here. Without this case that substitution is
    // invisible: measured, it kept the whole file green.
    const started = createTestServerHttp({
      serverInfo: createTestServerInfo("oauth-stalled-authorize", "1.0.0"),
      tools: [createEchoTool()],
      oauth: {
        enabled: true,
        mode: "combined",
        requireAuth: true,
        scopesSupported: ["mcp"],
        stallEndpoints: ["authorize"],
      },
    });
    await started.start();
    server = started;

    const url = new URL("/oauth/authorize", started.url);
    url.searchParams.set("client_id", "test-client");
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "redirect_uri",
      "http://127.0.0.1:6274/oauth/callback",
    );

    const timedFetch = withOAuthRequestTimeout(fetch, BUDGET_MS);
    await expect(timedFetch(url.href)).rejects.toThrow(
      OAuthRequestTimeoutError,
    );
  });

  it("rejects an unknown stallEndpoints entry instead of answering normally", async () => {
    // A typo must fail loudly. Ignored, it would produce a fixture that answers
    // promptly, and a timeout test written against it would fail pointing at
    // the timeout rather than at the config.
    //
    // The throw lands on `start()`, not on the constructor: routes — and so the
    // middleware — are built when the server is started. Asserting on the
    // constructor would pass for the wrong reason, since it never validates
    // anything.
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
    const started = await startFromConfig("oauth-stalled-token-http.json");
    const url = new URL("/oauth/token", started.url).href;

    // Deliberately unawaited and unbounded: the point is that a request with no
    // deadline of its own is in flight when the server goes down.
    const pending = fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=authorization_code&code=irrelevant",
    }).catch(() => "socket destroyed");

    // Give the request time to be accepted and parked before stopping.
    await new Promise((resolve) => setTimeout(resolve, 250));

    await expect(started.stop()).resolves.toBeUndefined();
    server = null;

    await expect(pending).resolves.toBe("socket destroyed");
  });
});
