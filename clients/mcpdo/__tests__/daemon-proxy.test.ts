import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, request, type Server } from "node:http";
import {
  createEchoTool,
  createTestServerHttp,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import { ConnectionRegistry } from "../src/daemon/connections.js";

/**
 * The daemon routes its connections through HTTPS_PROXY / HTTP_PROXY, honoring
 * NO_PROXY (#2642).
 *
 * Asserted behaviorally, through a real forwarding proxy, as the one-shot CLI's
 * proxy test is: `InspectorClient` always hands the transport a defined fetch,
 * so the transport-level proxy fallback never fires and the only thing that
 * puts a proxy under the daemon is `fetch: createProxyFetch()` on its
 * environment. Delete that line and the first case here goes red.
 *
 * Proxy variables are set for the WHOLE file and the ambient ones restored
 * after it. `createProxyFetch`'s `EnvHttpProxyAgent` is memoized process-wide
 * and captures the proxy URL when it is first built (only NO_PROXY is re-read
 * per request), so the proxy must be listening before any request is made and
 * stay listening until the last one.
 */
const PROXY_VARS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;

describe("daemon outbound proxy (#2642)", () => {
  const ambient: Record<string, string | undefined> = {};
  const seen: string[] = [];
  let proxy: Server;

  beforeAll(async () => {
    for (const name of PROXY_VARS) {
      ambient[name] = process.env[name];
      delete process.env[name];
    }
    proxy = createServer((req, res) => {
      seen.push(req.url ?? "");
      const target = new URL(req.url ?? "");
      const upstream = request(
        {
          host: target.hostname,
          port: target.port,
          path: target.pathname + target.search,
          method: req.method,
          headers: req.headers,
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
    const addr = proxy.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    process.env.HTTP_PROXY = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    for (const name of PROXY_VARS) {
      const previous = ambient[name];
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
    await new Promise<void>((r) => proxy.close(() => r()));
  });

  /** Connects the daemon registry to a live server and lists its tools; returns the server URL. */
  async function listToolsThroughDaemon(): Promise<string> {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });
    const registry = new ConnectionRegistry(0);
    try {
      await server.start();
      await registry.connect({
        name: "remote",
        serverConfig: { type: "streamable-http", url: server.url },
        serverIdentity: server.url,
      });
      const tools = await registry.resolve("remote", false).client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain("echo");
      return server.url;
    } finally {
      await registry.disconnect(undefined, false).catch(() => undefined);
      await server.stop();
    }
  }

  it("routes the connection through HTTP_PROXY", async () => {
    seen.length = 0;
    const serverUrl = await listToolsThroughDaemon();
    // The point of the test: it did not go direct.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((u) => u.startsWith(serverUrl))).toBe(true);
  });

  it("connects direct to a NO_PROXY host", async () => {
    seen.length = 0;
    // The test server announces itself as `localhost`, so that is the host to
    // exempt; NO_PROXY is re-read per request, so the memoized agent sees it.
    process.env.NO_PROXY = "localhost";
    try {
      await listToolsThroughDaemon();
      expect(seen).toEqual([]);
    } finally {
      delete process.env.NO_PROXY;
    }
  });
});
