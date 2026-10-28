/**
 * `guardedFetch` over real sockets — undici with the pinning lookup, direct
 * and through `EnvHttpProxyAgent` (#2749).
 *
 * The hostnames here (`*.test`) exist only in the injected resolvers, so a
 * request that reaches the fixture proves the socket connected to the address
 * the guard validated rather than to one it resolved for itself. The hop loop,
 * the adapter and the pure helpers are covered by the unit suite
 * (`src/test/core/mcp/node/fetchGuard.test.ts`).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  FetchTargetError,
  findFetchTargetError,
  guardedFetch,
  type GuardedFetchInit,
  type ResolveHost,
} from "@inspector/core/mcp/node/fetchGuard.js";

/** Starts an HTTP server on loopback, recording `host path` per request. */
async function listen(
  answer: string,
  hits: string[],
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    hits.push(`${req.headers.host} ${req.url}`);
    if (req.url === "/to-metadata-name") {
      res.writeHead(302, { Location: `http://metadata.test:${port}/` });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(answer);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  return { server, port };
}

// The suite owns the proxy environment: an ambient value would route these
// requests elsewhere, and the guard reads it on every call.
const PROXY_VARS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;
const savedProxyEnv: Partial<Record<string, string | undefined>> = {};

let upstream: { server: Server; port: number };
const upstreamHits: string[] = [];

beforeAll(async () => {
  for (const name of PROXY_VARS) {
    savedProxyEnv[name] = process.env[name];
    delete process.env[name];
  }
  upstream = await listen("pinned", upstreamHits);
});

afterAll(async () => {
  await new Promise<void>((r) => upstream.server.close(() => r()));
  for (const name of PROXY_VARS) {
    const previous = savedProxyEnv[name];
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});

/** Resolves `*.test` names from a fixed table. */
const resolveHost: ResolveHost = async (hostname) => {
  if (hostname === "pinned.test") return ["127.0.0.1"];
  if (hostname === "metadata.test") return ["169.254.169.254"];
  throw Object.assign(new Error(`ENOTFOUND ${hostname}`), {
    code: "ENOTFOUND",
  });
};

function init(): GuardedFetchInit {
  return {
    method: "GET",
    headers: {},
    body: undefined,
    signal: AbortSignal.timeout(5_000),
  };
}

function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe("guardedFetch (direct)", () => {
  it("connects to the address the guard validated", async () => {
    const res = await guardedFetch(
      `http://pinned.test:${upstream.port}/x`,
      init(),
      { resolveHost },
    );
    expect(await res.text()).toBe("pinned");
    expect(res).toBeInstanceOf(Response);
    expect(upstreamHits).toContain(`pinned.test:${upstream.port} /x`);
  });

  it("refuses a name that resolves to a metadata address", async () => {
    const err = await caught(
      guardedFetch(`http://metadata.test:${upstream.port}/`, init(), {
        resolveHost,
      }),
    );
    expect(findFetchTargetError(err)).toBeInstanceOf(FetchTargetError);
  });

  it("refuses a redirect to such a name", async () => {
    const before = upstreamHits.length;
    const err = await caught(
      guardedFetch(
        `http://pinned.test:${upstream.port}/to-metadata-name`,
        init(),
        { resolveHost },
      ),
    );
    expect(findFetchTargetError(err)?.message).toContain("169.254.169.254");
    expect(upstreamHits.slice(before)).toEqual([
      `pinned.test:${upstream.port} /to-metadata-name`,
    ]);
  });

  it("surfaces an unresolvable name as an ordinary fetch failure", async () => {
    const err = await caught(
      guardedFetch(`http://nowhere.test:${upstream.port}/`, init(), {
        resolveHost,
      }),
    );
    expect(err).toBeInstanceOf(Error);
    expect(findFetchTargetError(err)).toBeUndefined();
  });
});

// Copilot (#2796): `EnvHttpProxyAgent` connects a NO_PROXY host directly, so
// that path has to carry the pinning lookup too — the best-effort preflight
// alone would let a rebinding name through.
describe("guardedFetch behind HTTP_PROXY", () => {
  let proxy: { server: Server; port: number };
  const proxyHits: string[] = [];

  beforeAll(async () => {
    // Never forwards: a request it receives was routed through the proxy, and
    // its answer says so.
    proxy = await listen("via proxy", proxyHits);
  });

  afterAll(async () => {
    await new Promise<void>((r) => proxy.server.close(() => r()));
  });

  afterEach(() => {
    delete process.env.HTTP_PROXY;
    delete process.env.NO_PROXY;
  });

  it("routes a proxied host through the proxy", async () => {
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxy.port}`;
    const res = await guardedFetch(
      `http://upstream.test:${upstream.port}/p`,
      init(),
      { resolveHost },
    );
    expect(await res.text()).toBe("via proxy");
    expect(proxyHits).toContain(
      `upstream.test:${upstream.port} http://upstream.test:${upstream.port}/p`,
    );
  });

  it("pins a NO_PROXY host's direct connection", async () => {
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxy.port}`;
    process.env.NO_PROXY = "pinned.test";
    const proxied = proxyHits.length;
    const res = await guardedFetch(
      `http://pinned.test:${upstream.port}/bypass`,
      init(),
      // A resolver of its own, so this test builds its own agent.
      { resolveHost: async (h) => resolveHost(h) },
    );
    expect(await res.text()).toBe("pinned");
    expect(proxyHits).toHaveLength(proxied);
  });

  it("refuses a NO_PROXY name that rebinds after the preflight", async () => {
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxy.port}`;
    process.env.NO_PROXY = "rebind.test";
    // Answers the preflight with loopback and the connection with the IMDS.
    let calls = 0;
    const rebinding: ResolveHost = async () =>
      calls++ === 0 ? ["127.0.0.1"] : ["169.254.169.254"];
    const err = await caught(
      guardedFetch(`http://rebind.test:${upstream.port}/`, init(), {
        resolveHost: rebinding,
      }),
    );
    expect(calls).toBe(2);
    expect(findFetchTargetError(err)?.message).toContain("169.254.169.254");
  });
});
