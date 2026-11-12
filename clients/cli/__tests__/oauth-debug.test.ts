/**
 * `--oauth-debug` (#2844): the terminal wiring in `core/cli/oauth-debug.ts`
 * and the navigation hook it feeds. The trace format itself is unit-tested
 * with `core/auth/oauthDebug.ts` (clients/web/src/test/core/auth/).
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  TestServerHttp,
  waitForOAuthWellKnown,
  getDefaultServerConfig,
  createOAuthTestServerConfig,
  clearOAuthTestData,
} from "@modelcontextprotocol/inspector-test-server";
import { createServer, type AddressInfo } from "node:net";
import { runCli } from "./helpers/cli-runner.js";
import { createCliOAuthNavigation } from "@inspector/core/cli/cli-oauth-navigation.js";
import {
  createCliOAuthFetch,
  oauthDebugNavigationHook,
  traceCliOAuthFetch,
  writeOAuthDebugToStderr,
} from "@inspector/core/cli/oauth-debug.js";
import { OAUTH_DEBUG_PREFIX } from "@inspector/core/auth/oauthDebug.js";
import { openUrl } from "@inspector/core/node/openUrl.js";

vi.mock("@inspector/core/node/openUrl.js", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

const openUrlMock = vi.mocked(openUrl);

/**
 * Stand in for the browser: approve the test authorization server's consent
 * page and deliver the redirect to the CLI's loopback callback.
 */
async function completeInBrowser(href: string | URL): Promise<void> {
  const authorizationUrl = new URL(href);
  let response = await fetch(authorizationUrl, { redirect: "manual" });
  if (response.status === 200) {
    response = await fetch(
      `${authorizationUrl.origin}${authorizationUrl.pathname}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(authorizationUrl.searchParams),
        redirect: "manual",
      },
    );
  }
  const location = response.headers.get("location");
  if (!location) throw new Error(`No redirect (${String(response.status)})`);
  await fetch(new URL(location, authorizationUrl.origin));
}

/** A free loopback port for this file's callback listener. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

afterEach(() => {
  vi.restoreAllMocks();
  openUrlMock.mockReset();
  openUrlMock.mockResolvedValue(undefined);
});

describe("createCliOAuthFetch", () => {
  it("traces through the destination guard when on", async () => {
    const lines: string[] = [];
    const oauthFetch = createCliOAuthFetch(true, (line) => lines.push(line));
    // The guard refuses a cloud-metadata address before any socket opens, so
    // this exercises the real guard with no network.
    await expect(
      oauthFetch("http://169.254.169.254/.well-known/oauth-protected-resource"),
    ).rejects.toThrow();
    expect(lines[0]).toBe(
      `${OAUTH_DEBUG_PREFIX} protected-resource metadata: GET http://169.254.169.254/.well-known/oauth-protected-resource\n`,
    );
    expect(lines[1]).toMatch(/^\[oauth\] {3}-> failed: /);
  });

  it("is the bare guard, writing nothing, when off", async () => {
    const write = vi.fn();
    const oauthFetch = createCliOAuthFetch(false, write);
    await expect(oauthFetch("http://169.254.169.254/x")).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it("writes to stderr by default", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await expect(
      createCliOAuthFetch(true)("http://169.254.169.254/x"),
    ).rejects.toThrow();
    expect(stderr).toHaveBeenCalledWith(
      `${OAUTH_DEBUG_PREFIX} request: GET http://169.254.169.254/x\n`,
    );
  });
});

describe("traceCliOAuthFetch", () => {
  it("returns the fetch untouched when off", () => {
    const base = vi.fn<typeof fetch>();
    expect(traceCliOAuthFetch(base, false)).toBe(base);
  });

  it("traces a caller-composed fetch to stderr when on", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const base = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    await traceCliOAuthFetch(base, true)("https://as.example/x");
    expect(base).toHaveBeenCalledOnce();
    expect(stderr).toHaveBeenCalledWith(`${OAUTH_DEBUG_PREFIX}   -> 204\n`);
  });
});

describe("oauthDebugNavigationHook", () => {
  it("is undefined when the trace is off", () => {
    expect(oauthDebugNavigationHook(false)).toBeUndefined();
  });

  it("traces the authorize URL the armed navigation prints, and only that one", async () => {
    const lines: string[] = [];
    const control = { armed: false };
    const nav = createCliOAuthNavigation({
      isTTY: false,
      write: () => {},
      autoOpenEnabled: false,
      autoOpenControl: control,
      onAuthorizationUrl: oauthDebugNavigationHook(true, (line) =>
        lines.push(line),
      ),
    });
    // Disarmed: the SDK's connect-time URL nobody can complete is not traced.
    nav.navigateToAuthorization(new URL("https://as.example/authorize?a=1"));
    control.armed = true;
    nav.navigateToAuthorization(new URL("https://as.example/authorize?a=2"));
    await Promise.resolve();
    expect(lines).toEqual([
      `${OAUTH_DEBUG_PREFIX} authorization: open https://as.example/authorize?a=2\n`,
    ]);
  });

  it("writes to stderr by default", () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    oauthDebugNavigationHook(true)?.(new URL("https://as.example/authorize"));
    expect(stderr).toHaveBeenCalledWith(
      `${OAUTH_DEBUG_PREFIX} authorization: open https://as.example/authorize\n`,
    );
  });

  it("the default sink writes one line to stderr", () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    writeOAuthDebugToStderr("x\n");
    expect(stderr).toHaveBeenCalledWith("x\n");
  });
});

/** A full interactive login, booted server to listed tools. */
const OAUTH_ROUND_TRIP_MS = 30_000;

describe("--oauth-debug on the CLI", () => {
  let server: TestServerHttp;
  let serverUrl: string;

  beforeAll(async () => {
    server = new TestServerHttp({
      ...getDefaultServerConfig(),
      serverType: "streamable-http",
      ...createOAuthTestServerConfig({ requireAuth: true, supportDCR: true }),
    });
    const port = await server.start();
    await waitForOAuthWellKnown(`http://localhost:${port}`);
    serverUrl = `http://localhost:${port}/mcp`;
  });

  afterAll(async () => {
    await server.stop();
    clearOAuthTestData();
  });

  it(
    "traces every step of an interactive login to stderr, credentials redacted",
    async () => {
      openUrlMock.mockImplementation(completeInBrowser);
      const callbackPort = await freePort();
      const result = await runCli(
        [
          "--transport",
          "http",
          "--server-url",
          serverUrl,
          "--callback-url",
          `http://127.0.0.1:${String(callbackPort)}/oauth/callback`,
          "--method",
          "tools/list",
          "--oauth-debug",
        ],
        // Admits the interactive flow with no TTY and "opens the browser",
        // which here is `completeInBrowser`.
        { env: { MCP_AUTO_OPEN_ENABLED: "true" } },
      );
      expect(result.exitCode).toBe(0);
      const trace = result.stderr
        .split("\n")
        .filter((line) => line.startsWith(OAUTH_DEBUG_PREFIX));
      const steps = trace.map(
        (line) => line.slice(OAUTH_DEBUG_PREFIX.length + 1).split(":")[0],
      );
      expect(steps).toEqual(
        expect.arrayContaining([
          "protected-resource metadata",
          "authorization-server metadata",
          "client registration",
          "authorization",
          "token request",
        ]),
      );
      expect(result.stderr).toMatch(
        /token request: POST \S+ grant_type=authorization_code code=\[redacted\]/,
      );
      expect(result.stderr).toMatch(/"access_token":"\[redacted\]"/);
      expect(result.stdout).not.toContain(OAUTH_DEBUG_PREFIX);
    },
    OAUTH_ROUND_TRIP_MS,
  );
});
