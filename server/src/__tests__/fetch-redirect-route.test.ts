/**
 * Runtime check of redirect handling through the real `/fetch` route.
 *
 * proxy-redirect.test.ts covers nextRedirectRequest on its own; this file
 * imports the real index.ts and sends real requests, so a redirect loop in
 * safeProxyFetch that stops sending each hop's rewritten request (reusing the
 * caller's headers, method or body instead) fails here.
 *
 * index.ts reads its configuration and starts listening on import, so it is
 * configured through environment variables before a fresh dynamic import
 * (vi.resetModules) on a free port. The two upstreams listen on 127.0.0.1 on
 * different ports, so a hop between them changes origin.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";

const PROXY_TOKEN = "proxy-token-for-test-f6mc";
const CLIENT_ORIGIN = "http://localhost:6274";

interface Received {
  path: string;
  method: string;
  authorization: string | undefined;
  cookie: string | undefined;
  body: string;
}

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function waitForProxy(port: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`proxy did not start listening on port ${port}`);
}

/**
 * An upstream that records every request it receives. `/redirect/<status>?to=<url>`
 * answers with that redirect; anything else answers 200.
 */
async function startUpstream(log: Received[]): Promise<{
  server: http.Server;
  origin: string;
}> {
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://upstream.invalid");
      log.push({
        path: url.pathname,
        method: req.method ?? "",
        authorization: req.headers.authorization,
        cookie: req.headers.cookie,
        body,
      });
      const match = /^\/redirect\/(\d{3})$/.exec(url.pathname);
      const to = url.searchParams.get("to");
      if (match && to) {
        res.writeHead(Number(match[1]), { location: to });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("landed");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}` };
}

const received: { a: Received[]; b: Received[] } = { a: [], b: [] };
let upstreamA: Awaited<ReturnType<typeof startUpstream>>;
let upstreamB: Awaited<ReturnType<typeof startUpstream>>;
let proxyPort = 0;

/** POST /fetch as the bundled client does, with credentials on the request. */
async function proxyFetch(
  url: string,
  init: { method: string; body?: string },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${proxyPort}/fetch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: CLIENT_ORIGIN,
      "x-mcp-proxy-auth": `Bearer ${PROXY_TOKEN}`,
    },
    body: JSON.stringify({
      url,
      init: {
        method: init.method,
        headers: {
          Authorization: "Basic Y2xpZW50OnNlY3JldA==",
          Cookie: "session=abc123",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: init.body,
      },
    }),
  });
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

function redirectUrl(from: string, status: number, to: string): string {
  return `${from}/redirect/${status}?to=${encodeURIComponent(to)}`;
}

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  upstreamA = await startUpstream(received.a);
  upstreamB = await startUpstream(received.b);

  proxyPort = await freePort();
  vi.stubEnv("SERVER_PORT", String(proxyPort));
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("MCP_PROXY_AUTH_TOKEN", PROXY_TOKEN);
  vi.stubEnv("ALLOWED_ORIGINS", CLIENT_ORIGIN);
  vi.stubEnv("DANGEROUSLY_OMIT_AUTH", undefined);
  vi.resetModules();
  await import("../index.js");
  await waitForProxy(proxyPort);
});

beforeEach(() => {
  received.a.length = 0;
  received.b.length = 0;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => upstreamA.server.close(() => resolve()));
  await new Promise<void>((resolve) => upstreamB.server.close(() => resolve()));
});

describe("/fetch redirect handling", () => {
  it("drops credentials on a cross-origin 302", async () => {
    const { status, json } = await proxyFetch(
      redirectUrl(upstreamA.origin, 302, `${upstreamB.origin}/landed`),
      { method: "POST", body: "grant_type=refresh_token&refresh_token=r1" },
    );

    expect(status).toBe(200);
    expect(json.status).toBe(200);
    // The first hop carried the credentials to their own origin…
    expect(received.a).toHaveLength(1);
    expect(received.a[0].authorization).toBe("Basic Y2xpZW50OnNlY3JldA==");
    // …and the cross-origin hop arrived as a bodyless GET without them.
    expect(received.b).toEqual([
      {
        path: "/landed",
        method: "GET",
        authorization: undefined,
        cookie: undefined,
        body: "",
      },
    ]);
  });

  it("does not restore credentials when a later hop returns to their origin", async () => {
    // A → B (307, no body, so it is followed) → back to A (302).
    const backToA = `${upstreamA.origin}/landed`;
    const { status } = await proxyFetch(
      redirectUrl(
        upstreamA.origin,
        307,
        redirectUrl(upstreamB.origin, 302, backToA),
      ),
      { method: "GET" },
    );

    expect(status).toBe(200);
    expect(received.b).toHaveLength(1);
    expect(received.b[0].authorization).toBeUndefined();
    expect(received.a).toHaveLength(2);
    expect(received.a[0].authorization).toBe("Basic Y2xpZW50OnNlY3JldA==");
    expect(received.a[1]).toMatchObject({
      path: "/landed",
      authorization: undefined,
      cookie: undefined,
    });
  });

  it("refuses a cross-origin 307 of a POST with a body", async () => {
    const { status, json } = await proxyFetch(
      redirectUrl(upstreamA.origin, 307, `${upstreamB.origin}/landed`),
      { method: "POST", body: "grant_type=refresh_token&refresh_token=r1" },
    );

    expect(status).toBe(403);
    expect(json.error).toBe(
      "Refusing to follow a cross-origin redirect for a request with a body",
    );
    expect(received.a).toHaveLength(1);
    expect(received.b).toEqual([]);
  });

  it("follows a same-origin 307 with the body and credentials", async () => {
    const { status, json } = await proxyFetch(
      redirectUrl(upstreamA.origin, 307, `${upstreamA.origin}/landed`),
      { method: "POST", body: "grant_type=refresh_token&refresh_token=r1" },
    );

    expect(status).toBe(200);
    expect(json.body).toBe("landed");
    expect(received.a).toHaveLength(2);
    expect(received.a[1]).toEqual({
      path: "/landed",
      method: "POST",
      authorization: "Basic Y2xpZW50OnNlY3JldA==",
      cookie: "session=abc123",
      body: "grant_type=refresh_token&refresh_token=r1",
    });
    expect(received.b).toEqual([]);
  });
});
