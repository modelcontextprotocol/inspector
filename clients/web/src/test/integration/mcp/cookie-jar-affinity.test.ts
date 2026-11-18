/**
 * End-to-end coverage of the `cookieJar` setting (#2936) through the real SDK
 * transports and a load balancer that routes by cookie affinity.
 *
 * Two single-process test servers stand in for two replicas of one MCP
 * deployment. In front of them sits an in-process proxy shaped like a sticky
 * ingress: a request carrying its `lb` cookie goes to that replica, and any
 * other request is round-robined and answered with `Set-Cookie: lb=<replica>`.
 * A replica that does not hold the MCP session answers `404`, exactly as a
 * real deployment does.
 *
 * The control arm proves the proxy would break a connection without the jar,
 * so the jar arm passing is evidence of the jar rather than of a lenient
 * proxy. Both arms run on Streamable HTTP and on legacy SSE, since the jar is
 * wired into each transport's fetch chain separately.
 */
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  createNumberedTools,
} from "@modelcontextprotocol/inspector-test-server";

/** Hop-by-hop or recomputed headers the proxy must not copy verbatim. */
const SKIPPED_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "keep-alive",
]);

/**
 * Stream an upstream body to the client as it arrives, so an SSE response
 * reaches the transport event by event. Owns its failures (an aborted
 * upstream ends the response), so the caller may discard the promise.
 */
async function pipeBody(
  body: ReadableStream<Uint8Array>,
  res: http.ServerResponse,
): Promise<void> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch {
    // Upstream aborted (the client went away); just end the response.
  } finally {
    res.end();
  }
}

/** The only endpoints the fixture serves (`/mcp`, legacy `/sse`). */
const ENDPOINT_PATHS = ["/mcp", "/sse"] as const;

/**
 * The replica URL for an incoming request. Built from the replica's fixed
 * origin, a path picked from {@link ENDPOINT_PATHS}, and a validated legacy-SSE
 * `sessionId`, so a request cannot steer the proxy anywhere else.
 */
function upstreamUrl(origin: string, requestUrl: string | undefined): URL {
  const incoming = new URL(requestUrl ?? "/", "http://proxy.invalid");
  const path =
    ENDPOINT_PATHS.find((candidate) => candidate === incoming.pathname) ??
    "/mcp";
  const target = new URL(path, origin);
  const sessionId = incoming.searchParams.get("sessionId");
  if (sessionId && /^[\w-]+$/.test(sessionId)) {
    target.searchParams.set("sessionId", sessionId);
  }
  return target;
}

interface AffinityProxy {
  url: string;
  /** The `cookie` header of every request the proxy received, in order. */
  cookies: (string | undefined)[];
  stop(): Promise<void>;
}

/**
 * Start a round-robin proxy over `replicas` that pins a request to a replica
 * by its `lb` cookie.
 */
async function startAffinityProxy(
  replicas: readonly string[],
): Promise<AffinityProxy> {
  let next = 0;
  const cookies: (string | undefined)[] = [];
  const server = http.createServer((req, res) => {
    cookies.push(req.headers.cookie);
    const pinned = /(?:^|;\s*)lb=(\d+)/.exec(req.headers.cookie ?? "");
    const index = pinned ? Number(pinned[1]) : next++ % replicas.length;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const abort = new AbortController();
      res.on("close", () => abort.abort());
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (SKIPPED_HEADERS.has(name) || value === undefined) continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      fetch(upstreamUrl(replicas[index], req.url), {
        method: req.method,
        headers,
        body,
        signal: abort.signal,
      }).then(
        (upstream) => {
          const out: Record<string, string> = {};
          upstream.headers.forEach((value, name) => {
            if (!SKIPPED_HEADERS.has(name)) out[name] = value;
          });
          if (!pinned) out["set-cookie"] = `lb=${index}; Path=/; HttpOnly`;
          res.writeHead(upstream.status, out);
          if (!upstream.body) {
            res.end();
            return;
          }
          // pipeBody owns its failures: it ends the response on any error.
          void pipeBody(upstream.body, res);
        },
        () => {
          if (!res.headersSent) res.writeHead(502);
          res.end();
        },
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    cookies,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function settings(cookieJar: boolean): InspectorServerSettings {
  return {
    headers: [],
    metadata: {},
    env: [],
    connectionTimeout: 0,
    requestTimeout: 5_000,
    taskTtl: 60000,
    maxFetchRequests: 1000,
    roots: [],
    ...(cookieJar && { cookieJar: true }),
  };
}

describe.each(["streamable-http", "sse"] as const)(
  "cookieJar behind a cookie-affinity load balancer — %s (#2936)",
  (serverType) => {
    let client: InspectorClient | null = null;
    let replicas: TestServerHttp[] = [];
    let proxy: AffinityProxy | null = null;

    afterEach(async () => {
      await client?.disconnect().catch(() => {});
      client = null;
      await proxy?.stop().catch(() => {});
      proxy = null;
      await Promise.all(replicas.map((r) => r.stop().catch(() => {})));
      replicas = [];
    });

    async function connectThroughProxy(cookieJar: boolean) {
      replicas = [0, 1].map(() =>
        createTestServerHttp({
          serverInfo: createTestServerInfo("affinity-test", "1.0.0"),
          tools: createNumberedTools(2),
          serverType,
        }),
      );
      await Promise.all(replicas.map((r) => r.start()));
      proxy = await startAffinityProxy(
        replicas.map((r) => new URL(r.url).origin),
      );
      const path = serverType === "sse" ? "/sse" : "/mcp";
      const config: MCPServerConfig = {
        type: serverType,
        url: `${proxy.url}${path}`,
      };
      client = new InspectorClient(config, {
        environment: { transport: createTransportNode, fetch },
        serverSettings: settings(cookieJar),
      });
      return { client, proxy };
    }

    it("fails after the first exchange without the jar (control)", async () => {
      const { client: c, proxy: p } = await connectThroughProxy(false);
      await expect(
        (async () => {
          await c.connect();
          await c.listTools();
        })(),
      ).rejects.toThrow();
      expect(p.cookies.length).toBeGreaterThan(1);
      expect(p.cookies.every((cookie) => cookie === undefined)).toBe(true);
    });

    it("pins the session to one replica with the jar", async () => {
      const { client: c, proxy: p } = await connectThroughProxy(true);
      await c.connect();
      expect((await c.listTools()).tools).toHaveLength(2);
      expect(p.cookies[0]).toBeUndefined();
      expect(p.cookies.slice(1)).not.toHaveLength(0);
      expect(p.cookies.slice(1).every((cookie) => cookie === "lb=0")).toBe(
        true,
      );
    });
  },
);
