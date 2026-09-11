/**
 * Supplemental coverage for createRemoteApp (core/mcp/remote/node/server.ts).
 *
 * Targets the remaining uncovered branches the broader suites don't exercise:
 *   - forwardLogEvent message/binding shape variants (/api/log)
 *   - validateSettings per-field rejection branches
 *   - /api/fetch headers / streaming content-type / network-error paths
 *   - normalizeMcpServers malformed-field drops, on both the logger and the
 *     console.warn fallback path
 *   - generic (non-keychain) 500 catch on POST / PUT / DELETE / order
 *   - keychain-unavailable migration with a logger (fileLogger.warn branch)
 *   - GET fast-path re-check when a concurrent write removed the plaintext
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import type pinoType from "pino";
import {
  closeAbortedStream,
  createRemoteApp,
  requestIdForSendWait,
  mcpParamHeadersOnly,
} from "@inspector/core/mcp/remote/node/server.js";
import {
  InMemorySecretStore,
  KeychainUnavailableError,
  type SecretStore,
} from "@inspector/core/auth/node/secret-store.js";

interface Harness {
  baseUrl: string;
  server: ServerType;
  configPath: string;
  tempDir: string;
}

interface StartOpts {
  secretStore?: SecretStore;
  logger?: pinoType.Logger;
  seedConfig?: string;
}

async function start(opts: StartOpts = {}): Promise<Harness> {
  const tempDir = mkdtempSync(join(tmpdir(), "inspector-server-extra-"));
  const configPath = join(tempDir, "mcp.json");
  if (opts.seedConfig !== undefined) {
    writeFileSync(configPath, opts.seedConfig);
  }
  const { app } = createRemoteApp({
    dangerouslyOmitAuth: true,
    mcpConfigPath: configPath,
    initialConfig: { defaultEnvironment: {} },
    secretStore: opts.secretStore ?? new InMemorySecretStore(),
    logger: opts.logger,
  });
  const { baseUrl, server } = await new Promise<{
    baseUrl: string;
    server: ServerType;
  }>((resolve, reject) => {
    const s = serve(
      { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
      (info) => {
        const port =
          info && typeof info === "object" && "port" in info
            ? (info as { port: number }).port
            : 0;
        resolve({ baseUrl: `http://127.0.0.1:${port}`, server: s });
      },
    );
    s.on("error", reject);
  });
  return { baseUrl, server, configPath, tempDir };
}

async function stop(h: Harness): Promise<void> {
  await new Promise<void>((r) => h.server.close(() => r()));
  try {
    rmSync(h.tempDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

/**
 * Minimal in-memory pino-shaped logger that captures forwarded records so a
 * test can assert which level/object/message the server emitted.
 */
function makeCapturingLogger(): {
  logger: pinoType.Logger;
  records: Array<{ level: string; args: unknown[] }>;
} {
  const records: Array<{ level: string; args: unknown[] }> = [];
  const mk =
    (level: string) =>
    (...args: unknown[]) => {
      records.push({ level, args });
    };
  // Only the methods the server reaches are needed; cast through unknown to
  // satisfy the pino.Logger surface without pulling in the full type.
  const logger = {
    info: mk("info"),
    warn: mk("warn"),
    error: mk("error"),
    debug: mk("debug"),
    trace: mk("trace"),
    fatal: mk("fatal"),
  } as unknown as pinoType.Logger;
  return { logger, records };
}

describe("server.ts supplemental coverage", () => {
  describe("requestIdForSendWait (#1630)", () => {
    it("returns the id for an ordinary request", () => {
      expect(
        requestIdForSendWait({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
      ).toBe(7);
    });

    it("does not wait for a response on subscriptions/listen (long-lived stream)", () => {
      expect(
        requestIdForSendWait({
          jsonrpc: "2.0",
          id: "listen:0",
          method: "subscriptions/listen",
          params: {},
        }),
      ).toBeUndefined();
    });

    it("returns undefined for a notification (no id)", () => {
      expect(
        requestIdForSendWait({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      ).toBeUndefined();
    });
  });

  describe("mcpParamHeadersOnly (SEP-2243 upstream header allowlist, #1846)", () => {
    it("keeps only Mcp-Param-* headers (case-insensitive)", () => {
      expect(
        mcpParamHeadersOnly({
          "Mcp-Param-City": "London",
          "mcp-param-owner": "octocat",
        }),
      ).toEqual({ "Mcp-Param-City": "London", "mcp-param-owner": "octocat" });
    });

    it("drops non-Mcp-Param headers a client tries to inject", () => {
      expect(
        mcpParamHeadersOnly({
          Authorization: "Bearer evil",
          "X-Custom": "nope",
          "Mcp-Param-City": "London",
        }),
      ).toEqual({ "Mcp-Param-City": "London" });
    });

    it("drops non-string values", () => {
      expect(
        mcpParamHeadersOnly({
          "Mcp-Param-Bad": 5,
          "Mcp-Param-City": "London",
        }),
      ).toEqual({ "Mcp-Param-City": "London" });
    });

    it("returns undefined when nothing survives the filter", () => {
      expect(mcpParamHeadersOnly({ Authorization: "x" })).toBeUndefined();
      expect(mcpParamHeadersOnly(undefined)).toBeUndefined();
      expect(mcpParamHeadersOnly(null)).toBeUndefined();
      expect(mcpParamHeadersOnly("not-an-object")).toBeUndefined();
    });
  });

  describe("/api/log forwardLogEvent shapes", () => {
    let h: Harness;
    let records: Array<{ level: string; args: unknown[] }>;

    beforeEach(async () => {
      const cap = makeCapturingLogger();
      records = cap.records;
      h = await start({ logger: cap.logger });
    });
    afterEach(async () => {
      await stop(h);
    });

    async function postLog(body: unknown): Promise<Response> {
      return fetch(`${h.baseUrl}/api/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("forwards an event whose first message is an object (obj + msg + args)", async () => {
      const res = await postLog({
        level: { label: "warn", value: 40 },
        bindings: [{ component: "x" }, { category: "y" }],
        messages: [{ extra: 1 }, "hello", "a", "b"],
      });
      expect(res.status).toBe(200);
      const rec = records.find((r) => r.level === "warn");
      expect(rec).toBeDefined();
      expect(rec!.args[0]).toMatchObject({
        component: "x",
        category: "y",
        extra: 1,
      });
      expect(rec!.args[1]).toBe("hello");
      expect(rec!.args.slice(2)).toEqual(["a", "b"]);
    });

    it("forwards an event with no messages (bindings-only object)", async () => {
      const res = await postLog({
        level: { label: "info", value: 30 },
        bindings: [{ a: 1 }],
        messages: [],
      });
      expect(res.status).toBe(200);
      const rec = records.find((r) => r.level === "info");
      expect(rec).toBeDefined();
      expect(rec!.args).toEqual([{ a: 1 }]);
    });

    it("forwards a string-first message (bindings + msg + args)", async () => {
      const res = await postLog({
        level: { label: "info", value: 30 },
        bindings: [{ b: 2 }],
        messages: ["just a string", 1, 2],
      });
      expect(res.status).toBe(200);
      const rec = records.find(
        (r) => r.level === "info" && r.args[1] === "just a string",
      );
      expect(rec).toBeDefined();
      expect(rec!.args[0]).toMatchObject({ b: 2 });
      expect(rec!.args.slice(2)).toEqual([1, 2]);
    });

    it("defaults the level to info and tolerates non-array bindings/messages", async () => {
      const res = await postLog({ bindings: "nope", messages: "nope" });
      expect(res.status).toBe(200);
      const rec = records.find((r) => r.level === "info");
      expect(rec).toBeDefined();
      // bindings non-array → {} ; messages non-array → [] → bindings-only call
      expect(rec!.args).toEqual([{}]);
    });

    it("drops an event whose level has no matching logger method", async () => {
      const res = await postLog({
        level: { label: "nonsense", value: 1 },
        messages: ["x"],
      });
      expect(res.status).toBe(200);
      // No record captured for an unknown level.
      expect(records.length).toBe(0);
    });
  });

  describe("/api/log without a logger is a no-op", () => {
    it("returns 200 and swallows the event", async () => {
      const h = await start();
      try {
        const res = await fetch(`${h.baseUrl}/api/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: ["x"] }),
        });
        expect(res.status).toBe(200);
        // Invalid JSON also tolerated (catch → {}).
        const res2 = await fetch(`${h.baseUrl}/api/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        });
        expect(res2.status).toBe(200);
      } finally {
        await stop(h);
      }
    });
  });

  describe("/api/fetch", () => {
    let h: Harness;
    let target: ServerType;
    let targetUrl: string;
    /** Resolves when an upstream `/stall` request is closed by its client. */
    let stallClosed: Promise<void>;
    /** Paths the upstream fixture has actually received. */
    let upstreamHits: string[];
    /** Resolves when the never-ending `/stream-open` response is closed. */
    let openStreamClosed: Promise<void>;

    // Isolate the WHOLE suite from the developer's (or CI's) proxy environment.
    // Setting only uppercase HTTP_PROXY in the one proxy test would not be
    // enough: undici's EnvHttpProxyAgent prefers lowercase `http_proxy`, and
    // honors NO_PROXY dynamically, so an ambient value could route the request
    // elsewhere or bypass the proxy and fail the assertion. Suite-level rather
    // than per-test because the agent is memoized process-wide once built.
    const PROXY_VARS = [
      "HTTP_PROXY",
      "http_proxy",
      "HTTPS_PROXY",
      "https_proxy",
      "NO_PROXY",
      "no_proxy",
    ] as const;
    const savedProxyEnv: Partial<Record<string, string | undefined>> = {};

    beforeAll(() => {
      for (const name of PROXY_VARS) {
        savedProxyEnv[name] = process.env[name];
        delete process.env[name];
      }
    });

    afterAll(() => {
      for (const name of PROXY_VARS) {
        const previous = savedProxyEnv[name];
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }
    });

    beforeEach(async () => {
      h = await start();
      // A tiny upstream HTTP server we can point /api/fetch at.
      const { createServer } = await import("node:http");
      let markClosed: () => void = () => {};
      stallClosed = new Promise<void>((resolve) => {
        markClosed = resolve;
      });
      upstreamHits = [];
      let markStreamClosed: () => void = () => {};
      openStreamClosed = new Promise<void>((resolve) => {
        markStreamClosed = resolve;
      });
      const srv = createServer((req, res) => {
        upstreamHits.push(req.url ?? "");
        if (req.url === "/stream-open") {
          // Event-stream headers, one frame, and then nothing — the shape that
          // used to leave a socket open for good, because the route classifies
          // it as a stream, returns JSON without the body, and clears its
          // deadline on the way out.
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write("data: hi\n\n");
          res.on("close", () => markStreamClosed());
          return;
        }
        if (req.url === "/stall") {
          // Accept the request, answer nothing, and report when the client
          // gives up — the #2319 wedged-authorization-server shape. `close` on
          // the response fires whether the socket was torn down or the handler
          // simply ended, and nothing here ever ends it.
          res.on("close", () => markClosed());
          return;
        }
        if (req.url === "/stream") {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write("data: hi\n\n");
          res.end();
          return;
        }
        if (req.url === "/echo-headers") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ got: req.headers["x-probe"] ?? null }));
          return;
        }
        if (req.url === "/echo-mcp") {
          // Echo back every mirrored MCP header the proxy forwarded, so a test
          // can assert the browser-built Mcp-* headers survive the /api/fetch
          // hop verbatim (SEP-2243 header mirroring works through the proxy).
          const mcp: Record<string, string | string[] | undefined> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (k.toLowerCase().startsWith("mcp-")) mcp[k] = v;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(mcp));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("plain body");
      });
      await new Promise<void>((resolve) =>
        srv.listen(0, "127.0.0.1", () => resolve()),
      );
      target = srv as unknown as ServerType;
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      targetUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
      await new Promise<void>((r) =>
        (target as unknown as { close: (cb: () => void) => void }).close(() =>
          r(),
        ),
      );
      await stop(h);
    });

    it("releases the upstream request when the browser cancels (#2319)", async () => {
      // The point of forwarding the signal through `createRemoteFetch`: without
      // it the browser's abort settled only its own promise, and this handler
      // plus the upstream socket stayed pending for as long as the server cared
      // to stall — once per timed-out attempt. Asserted at the route rather
      // than on a mock, because the mock cannot show the socket being released.
      const caller = new AbortController();
      const pending = fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: `${targetUrl}/stall` }),
        signal: caller.signal,
      });
      const rejected = pending.catch((err: unknown) => err);

      // Wait until the upstream has actually received the request, so the abort
      // cannot race ahead of it and pass for the wrong reason.
      await vi.waitFor(() => {
        expect(upstreamHits).toContain("/stall");
      });
      caller.abort();

      expect(await rejected).toBeInstanceOf(Error);
      // The upstream sees its connection go away. Without the signal composed
      // into the route's outbound fetch this never resolves and the test times
      // out.
      await stallClosed;
    });

    it("cancels a discarded stream that sends headers and never ends (#2319)", async () => {
      // The route answers with JSON and no body, so nobody downstream owns the
      // upstream stream and nothing will ever read it; the route cancels it
      // explicitly rather than relying on that being reclaimed for it.
      //
      // ⚠️ This pins the OUTCOME, not the mechanism: measured, it still passes
      // with the explicit `cancel()` removed, because undici reclaims an unread
      // response body here on its own. So the cancel is defensive — it makes
      // the release explicit and independent of that behaviour — and this test
      // will catch the route starting to hold the stream open, not the cancel
      // being deleted. Said plainly rather than left to imply a stronger claim.
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: `${targetUrl}/stream-open` }),
      });

      expect(res.status).toBe(200);
      const payload = (await res.json()) as { status: number; body?: string };
      expect(payload.status).toBe(200);
      expect(payload.body).toBeUndefined();
      // The observable contract: the route does not leave the upstream stream
      // running after it has answered. (Per the qualification above, this does
      // not isolate the explicit `cancel()` as the cause.)
      await openStreamClosed;
    });

    it("answers 504 with a typed marker when the request's deadline fires (#2319)", async () => {
      // The caller's budget travels in the envelope, so this costs milliseconds
      // rather than the production thirty seconds. The marker matters because
      // a backend-enforced deadline is the only one on the transport-internal
      // discovery path, and its error has to survive the hop as something an
      // `instanceof OAuthRequestTimeoutError` check can still recognize.
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: `${targetUrl}/stall`, timeoutMs: 120 }),
      });

      expect(res.status).toBe(504);
      const payload = (await res.json()) as {
        error: string;
        code: string;
        url: string;
        timeoutMs: number;
      };
      expect(payload.code).toBe("oauth_request_timeout");
      expect(payload.url).toBe(`${targetUrl}/stall`);
      expect(payload.timeoutMs).toBe(120);
      expect(payload.error).toContain("timed out after 120ms");
      // And the upstream is released rather than left running.
      await stallClosed;
    });

    it("applies no deadline to a request that carries none (#2319)", async () => {
      // ⚠️ The regression this guards: an unconditional timer here would abort
      // a Streamable HTTP tool call that legitimately withholds its response
      // headers — reintroducing on the backend exactly what `exemptMcpEndpoint`
      // prevents on the client, and reporting it as an OAuth timeout besides.
      const caller = new AbortController();
      const pending = fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: `${targetUrl}/stall` }),
        signal: caller.signal,
      });
      const settled = pending.then(
        (r) => `responded ${r.status}`,
        () => "aborted by us",
      );

      await vi.waitFor(() => {
        expect(upstreamHits).toContain("/stall");
      });
      // Well past any budget the route might have applied on its own. Nothing
      // should have answered: an unbounded request is still in flight.
      await new Promise((r) => setTimeout(r, 400));
      expect(
        await Promise.race([settled, Promise.resolve("still pending")]),
      ).toBe("still pending");

      caller.abort();
      expect(await settled).toBe("aborted by us");
    });

    it("ignores a non-numeric deadline rather than trusting it (#2319)", async () => {
      const caller = new AbortController();
      const pending = fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: `${targetUrl}/stall`,
          timeoutMs: "soon",
        }),
        signal: caller.signal,
      });
      const settled = pending.then(
        (r) => `responded ${r.status}`,
        () => "aborted by us",
      );

      await vi.waitFor(() => {
        expect(upstreamHits).toContain("/stall");
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(
        await Promise.race([settled, Promise.resolve("still pending")]),
      ).toBe("still pending");

      caller.abort();
      expect(await settled).toBe("aborted by us");
    });

    it("routes the outbound request through HTTP_PROXY (#2067)", async () => {
      // /api/fetch is the browser's ONLY way out to the network — the web
      // client's `environment.fetch` is `createRemoteFetch()`, which forwards
      // OAuth discovery and token requests here. On the bare global `fetch` a
      // corporate-proxy user could connect to a server but never authorize
      // against it, and Node's native NODE_USE_ENV_PROXY does not cover them
      // (unsupported at the 22.19 engine floor).
      const { createServer } = await import("node:http");
      const { request } = await import("node:http");
      const seen: string[] = [];
      const proxy = createServer((req, res) => {
        seen.push(req.url ?? "");
        const u = new URL(req.url ?? "");
        const up = request(
          {
            host: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            method: req.method,
            headers: req.headers,
          },
          (r) => {
            res.writeHead(r.statusCode ?? 502, r.headers);
            r.pipe(res);
          },
        );
        up.on("error", () => {
          res.writeHead(502);
          res.end();
        });
        req.pipe(up);
      });
      await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
      const proxyAddr = proxy.address();
      const proxyPort =
        typeof proxyAddr === "object" && proxyAddr !== null
          ? proxyAddr.port
          : 0;
      process.env.HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;

      try {
        const res = await fetch(`${h.baseUrl}/api/fetch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: `${targetUrl}/plain` }),
        });
        expect(res.status).toBe(200);
        expect(seen).toEqual([`${targetUrl}/plain`]);
      } finally {
        delete process.env.HTTP_PROXY;
        await new Promise<void>((r) => proxy.close(() => r()));
      }
    });

    it("forwards method + headers and returns the response body", async () => {
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `${targetUrl}/echo-headers`,
          method: "GET",
          headers: { "x-probe": "abc" },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        status: number;
        headers: Record<string, string>;
        body?: string;
      };
      expect(body.ok).toBe(true);
      expect(body.status).toBe(200);
      expect(body.headers["content-type"]).toContain("application/json");
      expect(JSON.parse(body.body!)).toEqual({ got: "abc" });
    });

    it("forwards modern MCP mirrored headers verbatim (SEP-2243 mirroring through the proxy)", async () => {
      // The browser-side SDK builds Mcp-Method / Mcp-Name / Mcp-Param-* /
      // MCP-Protocol-Version before calling the (proxied) fetch; /api/fetch must
      // re-send them unchanged so mirroring is preserved on the browser path.
      const mirrored = {
        "Mcp-Method": "tools/call",
        "Mcp-Name": "get_weather",
        "Mcp-Param-City": "=?base64?U8OjbyBQYXVsbw==?=",
        "MCP-Protocol-Version": "2026-07-28",
      };
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `${targetUrl}/echo-mcp`,
          method: "POST",
          headers: mirrored,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { body?: string };
      const echoed = JSON.parse(body.body!) as Record<string, string>;
      expect(echoed["mcp-method"]).toBe("tools/call");
      expect(echoed["mcp-name"]).toBe("get_weather");
      expect(echoed["mcp-param-city"]).toBe("=?base64?U8OjbyBQYXVsbw==?=");
      expect(echoed["mcp-protocol-version"]).toBe("2026-07-28");
    });

    it("omits the body for an event-stream content type", async () => {
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `${targetUrl}/stream` }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { body?: string; status: number };
      expect(body.status).toBe(200);
      expect(body.body).toBeUndefined();
    });

    it("returns 400 when url is missing", async () => {
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "GET" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 on invalid JSON", async () => {
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad",
      });
      expect(res.status).toBe(400);
    });

    it("returns 500 when the upstream fetch throws", async () => {
      const res = await fetch(`${h.baseUrl}/api/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1:1/nope" }),
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(typeof body.error).toBe("string");
    });
  });

  describe("validateSettings rejection branches (POST /api/servers)", () => {
    let h: Harness;
    beforeEach(async () => {
      h = await start();
    });
    afterEach(async () => {
      await stop(h);
    });

    async function postSettings(settings: unknown): Promise<Response> {
      return fetch(`${h.baseUrl}/api/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "srv",
          config: { type: "stdio", command: "node" },
          settings,
        }),
      });
    }

    const base = {
      headers: [],
      metadata: {},
      connectionTimeout: 0,
      requestTimeout: 0,
    };

    it("rejects a non-object settings value", async () => {
      const res = await postSettings([1, 2, 3]);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/must be an object/);
    });

    it("rejects malformed headers", async () => {
      const res = await postSettings({ ...base, headers: "oops" });
      expect((await res.json()).error).toMatch(/headers/);
    });

    it("rejects malformed metadata", async () => {
      const res = await postSettings({
        ...base,
        metadata: [{ key: 1, value: "x" }],
      });
      expect((await res.json()).error).toMatch(/metadata/);
    });

    it("rejects malformed env", async () => {
      const res = await postSettings({ ...base, env: "oops" });
      expect((await res.json()).error).toMatch(/env/);
    });

    it("rejects a non-string cwd", async () => {
      const res = await postSettings({ ...base, cwd: 42 });
      expect((await res.json()).error).toMatch(/cwd/);
    });

    it("rejects a negative connectionTimeout", async () => {
      const res = await postSettings({ ...base, connectionTimeout: -1 });
      expect((await res.json()).error).toMatch(/connectionTimeout/);
    });

    it("rejects a non-numeric requestTimeout", async () => {
      const res = await postSettings({ ...base, requestTimeout: "x" });
      expect((await res.json()).error).toMatch(/requestTimeout/);
    });

    it("rejects a negative taskTtl", async () => {
      const res = await postSettings({ ...base, taskTtl: -5 });
      expect((await res.json()).error).toMatch(/taskTtl/);
    });

    it("rejects a non-boolean autoRefreshOnListChanged", async () => {
      const res = await postSettings({
        ...base,
        autoRefreshOnListChanged: "yes",
      });
      expect((await res.json()).error).toMatch(/autoRefreshOnListChanged/);
    });

    it("rejects a non-boolean paginatedLists", async () => {
      const res = await postSettings({
        ...base,
        paginatedLists: "yes",
      });
      expect((await res.json()).error).toMatch(/paginatedLists/);
    });

    it("rejects a negative maxFetchRequests", async () => {
      const res = await postSettings({ ...base, maxFetchRequests: -2 });
      expect((await res.json()).error).toMatch(/maxFetchRequests/);
    });

    it("rejects a non-string OAuth field", async () => {
      const res = await postSettings({ ...base, oauthClientId: 7 });
      expect((await res.json()).error).toMatch(/oauthClientId/);
    });

    it("rejects a non-boolean enterpriseManaged", async () => {
      const res = await postSettings({ ...base, enterpriseManaged: "yes" });
      expect((await res.json()).error).toMatch(/enterpriseManaged/);
    });

    it("rejects a non-boolean oauthRequestRefreshToken (#2068)", async () => {
      const res = await postSettings({
        ...base,
        oauthRequestRefreshToken: "no",
      });
      expect((await res.json()).error).toMatch(/oauthRequestRefreshToken/);
    });

    it("rejects a non-boolean oauthRevokeOnClear (#2144)", async () => {
      const res = await postSettings({ ...base, oauthRevokeOnClear: "no" });
      expect((await res.json()).error).toMatch(/oauthRevokeOnClear/);
    });

    it("rejects malformed roots", async () => {
      const res = await postSettings({ ...base, roots: [{ uri: 1 }] });
      expect((await res.json()).error).toMatch(/roots/);
    });

    it("rejects an unknown protocolEra", async () => {
      const res = await postSettings({ ...base, protocolEra: "future" });
      expect((await res.json()).error).toMatch(/protocolEra/);
    });

    it("rejects an unknown modernLogLevel (#1629)", async () => {
      const res = await postSettings({ ...base, modernLogLevel: "verbose" });
      expect((await res.json()).error).toMatch(/modernLogLevel/);
    });

    it("rejects a non-boolean-valued advertisedExtensions (#1739)", async () => {
      const res = await postSettings({
        ...base,
        advertisedExtensions: { "io.modelcontextprotocol/tasks": "yes" },
      });
      expect((await res.json()).error).toMatch(/advertisedExtensions/);
    });

    it("rejects a non-object advertisedExtensions (#1739)", async () => {
      const res = await postSettings({
        ...base,
        advertisedExtensions: ["io.modelcontextprotocol/tasks"],
      });
      expect((await res.json()).error).toMatch(/advertisedExtensions/);
    });

    it("accepts an empty advertisedExtensions map without persisting it (#1739)", async () => {
      const res = await postSettings({ ...base, advertisedExtensions: {} });
      expect(res.status).toBe(200);
    });

    // #2068 — a 200 only proves the payload validated. Without reading the
    // saved entry back, deleting the `oauthRequestRefreshToken` line from
    // `normalizeSettings` leaves every other test green while saves through
    // this route silently revert to the default.
    it("persists the refresh-token opt-out through a save", async () => {
      expect(
        (await postSettings({ ...base, oauthRequestRefreshToken: false }))
          .status,
      ).toBe(200);

      const res = await fetch(`${h.baseUrl}/api/servers`);
      const body = (await res.json()) as {
        mcpServers: Record<
          string,
          { oauth?: { requestRefreshToken?: boolean } }
        >;
      };
      expect(body.mcpServers.srv?.oauth?.requestRefreshToken).toBe(false);
    });

    it("writes no refresh-token field when the setting is on", async () => {
      expect(
        (await postSettings({ ...base, oauthRequestRefreshToken: true }))
          .status,
      ).toBe(200);

      const res = await fetch(`${h.baseUrl}/api/servers`);
      const body = (await res.json()) as {
        mcpServers: Record<string, { oauth?: Record<string, unknown> }>;
      };
      expect(body.mcpServers.srv?.oauth?.requestRefreshToken).toBeUndefined();
    });

    // #2144 — same reasoning as the refresh-token pair above: a 200 only proves
    // the payload validated, not that the field survived the write-through.
    it("persists the revoke-on-clear opt-out through a save", async () => {
      expect(
        (await postSettings({ ...base, oauthRevokeOnClear: false })).status,
      ).toBe(200);

      const res = await fetch(`${h.baseUrl}/api/servers`);
      const body = (await res.json()) as {
        mcpServers: Record<string, { oauth?: { revokeOnClear?: boolean } }>;
      };
      expect(body.mcpServers.srv?.oauth?.revokeOnClear).toBe(false);
    });

    it("writes no revoke-on-clear field when the setting is on", async () => {
      expect(
        (await postSettings({ ...base, oauthRevokeOnClear: true })).status,
      ).toBe(200);

      const res = await fetch(`${h.baseUrl}/api/servers`);
      const body = (await res.json()) as {
        mcpServers: Record<string, { oauth?: Record<string, unknown> }>;
      };
      expect(body.mcpServers.srv?.oauth?.revokeOnClear).toBeUndefined();
    });

    it("accepts a fully-populated valid settings payload", async () => {
      const res = await postSettings({
        ...base,
        env: [{ key: "K", value: "V" }],
        cwd: "/tmp",
        taskTtl: 1000,
        autoRefreshOnListChanged: true,
        paginatedLists: true,
        advertisedExtensions: { "io.modelcontextprotocol/tasks": false },
        maxFetchRequests: 5,
        protocolEra: "modern",
        modernLogLevel: "off",
        oauthClientId: "cid",
        oauthScopes: "a b",
        enterpriseManaged: true,
        oauthRequestRefreshToken: false,
        oauthRevokeOnClear: false,
        roots: [{ uri: "file:///x", name: "x" }],
      });
      expect(res.status).toBe(200);
    });
  });

  describe("normalizeMcpServers malformed-field drops (console fallback, no logger)", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("drops a legacy settings node and every malformed field, logging to console.warn", async () => {
      const h = await start({
        seedConfig: JSON.stringify({
          mcpServers: {
            // non-object entry → skipped
            bad: 5,
            srv: {
              type: "http",
              url: "https://x.test/mcp",
              settings: { legacy: true },
              // object with a non-string value → isStringRecord inner branch
              headers: { Authorization: 123 },
              metadata: [{ key: 1 }],
              connectionTimeout: Infinity,
              requestTimeout: -1,
              taskTtl: "x",
              maxFetchRequests: -1,
              // unknown era literal → isProtocolEra branch
              protocolEra: "future",
              // unknown modern log level → isModernLogLevel branch (#1629)
              modernLogLevel: "verbose",
              // enterpriseManaged non-boolean → isOauthObject inner branch
              oauth: { enterpriseManaged: "yes" },
              // a non-string `name` → isRootArray inner branch
              roots: [{ uri: "file:///ok", name: 5 }],
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          mcpServers: Record<string, Record<string, unknown>>;
        };
        const srv = body.mcpServers.srv;
        expect(srv).toBeDefined();
        // type:"http" normalized to streamable-http
        expect(srv.type).toBe("streamable-http");
        // Every malformed field dropped.
        for (const k of [
          "settings",
          "headers",
          "metadata",
          "connectionTimeout",
          "requestTimeout",
          "taskTtl",
          "maxFetchRequests",
          "protocolEra",
          "modernLogLevel",
          "oauth",
          "roots",
        ]) {
          expect(srv).not.toHaveProperty(k);
        }
        expect(body.mcpServers.bad).toBeUndefined();
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        await stop(h);
      }
    });
  });

  describe("normalizeMcpServers additional validator inner branches", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("drops oauth with a non-string clientId and roots with a null entry", async () => {
      const h = await start({
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              // clientId non-string → isOauthObject clientId branch
              oauth: { clientId: 5 },
              // a null entry → isRootArray `e === null` branch
              roots: [null],
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          mcpServers: Record<string, Record<string, unknown>>;
        };
        expect(body.mcpServers.srv).not.toHaveProperty("oauth");
        expect(body.mcpServers.srv).not.toHaveProperty("roots");
      } finally {
        await stop(h);
      }
    });

    // #2018 — authorizationParams must be a string record; a hand-edited file
    // with anything else drops the whole `oauth` node rather than feeding
    // non-string values to the authorize-URL merge.
    it("drops oauth whose authorizationParams is not a string record", async () => {
      const h = await start({
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              oauth: { authorizationParams: { kc_idp_hint: 5 } },
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          mcpServers: Record<string, Record<string, unknown>>;
        };
        expect(body.mcpServers.srv).not.toHaveProperty("oauth");
      } finally {
        await stop(h);
      }
    });

    // #2068 — same all-or-nothing rule for the refresh-token opt-out: a
    // non-boolean drops the whole `oauth` node rather than reaching the
    // provider, where only an explicit `false` means anything.
    it("drops oauth whose requestRefreshToken is not a boolean", async () => {
      const h = await start({
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              oauth: { requestRefreshToken: "no" },
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        const body = (await res.json()) as {
          mcpServers: Record<string, Record<string, unknown>>;
        };
        expect(body.mcpServers.srv).not.toHaveProperty("oauth");
      } finally {
        await stop(h);
      }
    });

    // #2144 — same all-or-nothing rule for the revocation opt-out.
    it("drops oauth whose revokeOnClear is not a boolean", async () => {
      const h = await start({
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              oauth: { revokeOnClear: "no" },
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        const body = (await res.json()) as {
          mcpServers: Record<string, Record<string, unknown>>;
        };
        expect(body.mcpServers.srv).not.toHaveProperty("oauth");
      } finally {
        await stop(h);
      }
    });

    it("keeps a well-formed requestRefreshToken opt-out on read (#2068)", async () => {
      const h = await start({
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              oauth: { requestRefreshToken: false },
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        const body = (await res.json()) as {
          mcpServers: Record<string, Record<string, unknown>>;
        };
        expect(body.mcpServers.srv?.oauth).toEqual({
          requestRefreshToken: false,
        });
      } finally {
        await stop(h);
      }
    });

    it("keeps a well-formed authorizationParams record on read", async () => {
      const h = await start({
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              oauth: { authorizationParams: { kc_idp_hint: "corp" } },
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        const body = (await res.json()) as {
          mcpServers: Record<string, Record<string, unknown>>;
        };
        expect(body.mcpServers.srv?.oauth).toEqual({
          authorizationParams: { kc_idp_hint: "corp" },
        });
      } finally {
        await stop(h);
      }
    });
  });

  describe("plaintext-secret migration over a mixed config", () => {
    it("migrates servers with secrets and passes through servers without", async () => {
      // With an available keychain, the GET slow path migrates plaintext into
      // the store. A mixed config (one server with a secret, one without)
      // exercises both the migrate branch and the no-secret continue branch.
      const store = new InMemorySecretStore();
      const h = await start({
        secretStore: store,
        seedConfig: JSON.stringify({
          mcpServers: {
            plain: { type: "stdio", command: "node" },
            withSecret: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              oauth: { clientId: "cid", clientSecret: "shh" },
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          mcpServers: Record<string, Record<string, unknown>>;
        };
        // Both entries present; the secret value is rehydrated from keychain.
        expect(body.mcpServers.plain).toBeDefined();
        expect(body.mcpServers.withSecret).toBeDefined();
        // Disk no longer holds the plaintext clientSecret (migrated out).
        const onDisk = readFileSync(h.configPath, "utf-8");
        expect(onDisk).not.toContain("shh");
      } finally {
        await stop(h);
      }
    });
  });

  describe("normalizeMcpServers malformed-field drops (logger path)", () => {
    it("routes the drop warnings through fileLogger.warn", async () => {
      const cap = makeCapturingLogger();
      const h = await start({
        logger: cap.logger,
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "stdio",
              command: "node",
              headers: 123,
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        expect(res.status).toBe(200);
        const warned = cap.records.filter((r) => r.level === "warn");
        expect(warned.length).toBeGreaterThan(0);
      } finally {
        await stop(h);
      }
    });
  });

  describe("generic 500 catch on mutating routes", () => {
    // A secret store whose deleteAllForServer throws a plain (non-keychain)
    // error drives the generic 500 catch on POST and DELETE; the writeKeychain
    // path covers PUT.
    class ThrowingSecretStore implements SecretStore {
      async get(): Promise<string | null> {
        return null;
      }
      async set(): Promise<void> {
        throw new Error("boom-set");
      }
      async delete(): Promise<void> {
        /* no-op */
      }
      async deleteAllForServer(): Promise<void> {
        throw new Error("boom-sweep");
      }
    }

    it("POST returns 500 when the keychain sweep throws a generic error", async () => {
      const h = await start({ secretStore: new ThrowingSecretStore() });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "srv",
            config: { type: "stdio", command: "node" },
          }),
        });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/Failed to add server/);
      } finally {
        await stop(h);
      }
    });

    it("DELETE returns 500 when the keychain sweep throws a generic error", async () => {
      const h = await start({
        secretStore: new ThrowingSecretStore(),
        seedConfig: JSON.stringify({
          mcpServers: { srv: { type: "stdio", command: "node" } },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers/srv`, {
          method: "DELETE",
        });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/Failed to delete server/);
      } finally {
        await stop(h);
      }
    });

    it("PUT returns 500 when the keychain write throws a generic error", async () => {
      const h = await start({
        secretStore: new ThrowingSecretStore(),
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: { type: "streamable-http", url: "https://x.test/mcp" },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers/srv`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: { type: "streamable-http", url: "https://x.test/mcp" },
            settings: {
              headers: [],
              metadata: {},
              connectionTimeout: 0,
              requestTimeout: 0,
              oauthClientSecret: "shh",
            },
          }),
        });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/Failed to update server/);
      } finally {
        await stop(h);
      }
    });

    it("order returns 500 when the disk write throws", async () => {
      // Point the config at a path whose parent is a file, so the atomic
      // write fails with ENOTDIR — a generic error surfaced as 500.
      const tempDir = mkdtempSync(join(tmpdir(), "inspector-order-500-"));
      const filePath = join(tempDir, "afile");
      writeFileSync(filePath, "x");
      const badConfigPath = join(filePath, "mcp.json");
      const { app } = createRemoteApp({
        dangerouslyOmitAuth: true,
        mcpConfigPath: badConfigPath,
        initialConfig: { defaultEnvironment: {} },
        secretStore: new InMemorySecretStore(),
      });
      const { baseUrl, server } = await new Promise<{
        baseUrl: string;
        server: ServerType;
      }>((resolve, reject) => {
        const s = serve(
          { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
          (info) => {
            const port =
              info && typeof info === "object" && "port" in info
                ? (info as { port: number }).port
                : 0;
            resolve({ baseUrl: `http://127.0.0.1:${port}`, server: s });
          },
        );
        s.on("error", reject);
      });
      try {
        // readMcpConfig sees ENOENT (parent is a file) → empty list, so an
        // empty order set-matches and we proceed to the failing write.
        const res = await fetch(`${baseUrl}/api/servers/order`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: [] }),
        });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/Failed to reorder servers/);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
        rmSync(tempDir, { recursive: true });
      }
    });
  });

  describe("keychain-unavailable migration with a logger", () => {
    class UnavailableStore implements SecretStore {
      async get(): Promise<string | null> {
        return null;
      }
      async set(): Promise<void> {
        throw new KeychainUnavailableError(new Error("libsecret missing"));
      }
      async delete(): Promise<void> {
        /* no-op */
      }
      async deleteAllForServer(): Promise<void> {
        /* no-op */
      }
    }

    it("warns via the logger and preserves on-disk plaintext", async () => {
      const cap = makeCapturingLogger();
      const h = await start({
        secretStore: new UnavailableStore(),
        logger: cap.logger,
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              oauth: { clientId: "cid", clientSecret: "plaintext" },
            },
          },
        }),
      });
      try {
        const before = readFileSync(h.configPath, "utf-8");
        const res = await fetch(`${h.baseUrl}/api/servers`);
        expect(res.status).toBe(200);
        // Disk plaintext preserved (migration abandoned).
        expect(readFileSync(h.configPath, "utf-8")).toBe(before);
        const warned = cap.records.filter(
          (r) =>
            r.level === "warn" &&
            // Wording broadened with the store: a file-backed store fails for
            // reasons that have nothing to do with a keychain.
            JSON.stringify(r.args).includes("Secret store unavailable"),
        );
        expect(warned.length).toBeGreaterThan(0);
      } finally {
        await stop(h);
      }
    });
  });

  describe("keychain-unavailable 503 on PUT/DELETE", () => {
    class UnavailableOnWriteStore implements SecretStore {
      async get(): Promise<string | null> {
        return null;
      }
      async set(): Promise<void> {
        throw new KeychainUnavailableError(new Error("libsecret missing"));
      }
      async delete(): Promise<void> {
        /* no-op */
      }
      async deleteAllForServer(): Promise<void> {
        throw new KeychainUnavailableError(new Error("libsecret missing"));
      }
    }

    it("PUT returns 503 when the keychain write is unavailable", async () => {
      const h = await start({
        secretStore: new UnavailableOnWriteStore(),
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              oauth: { clientId: "cid", clientSecret: "shh" },
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers/srv`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: { type: "streamable-http", url: "https://x.test/mcp" },
            settings: {
              headers: [],
              metadata: {},
              connectionTimeout: 0,
              requestTimeout: 0,
              oauthClientSecret: "new-secret",
            },
          }),
        });
        expect(res.status).toBe(503);
        expect((await res.json()).error).toMatch(/libsecret missing/);
      } finally {
        await stop(h);
      }
    });

    it("DELETE returns 503 when the keychain sweep is unavailable", async () => {
      const h = await start({
        secretStore: new UnavailableOnWriteStore(),
        seedConfig: JSON.stringify({
          mcpServers: { srv: { type: "stdio", command: "node" } },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers/srv`, {
          method: "DELETE",
        });
        expect(res.status).toBe(503);
        expect((await res.json()).error).toMatch(/libsecret missing/);
      } finally {
        await stop(h);
      }
    });
  });

  describe("migratePlaintextSecrets rethrows a non-keychain error", () => {
    class ThrowingOnGetStore implements SecretStore {
      async get(): Promise<string | null> {
        throw new Error("disk full");
      }
      async set(): Promise<void> {
        /* unreachable in this test */
      }
      async delete(): Promise<void> {
        /* no-op */
      }
      async deleteAllForServer(): Promise<void> {
        /* no-op */
      }
    }

    it("GET /api/servers returns 500 when migration hits a non-KeychainUnavailableError", async () => {
      const h = await start({
        secretStore: new ThrowingOnGetStore(),
        seedConfig: JSON.stringify({
          mcpServers: {
            srv: {
              type: "streamable-http",
              url: "https://x.test/mcp",
              oauth: { clientId: "cid", clientSecret: "shh" },
            },
          },
        }),
      });
      try {
        const res = await fetch(`${h.baseUrl}/api/servers`);
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/Failed to read server list/);
      } finally {
        await stop(h);
      }
    });
  });
  describe("closeAbortedStream", () => {
    it("owns a rejected close instead of letting it go unhandled", async () => {
      // The whole reason the helper exists. Both SSE `onAbort` listeners run
      // after the peer is already gone, so `close()` can lose the race and
      // reject — and Hono invokes abort subscribers with a bare
      // `subscriber()`, so nothing upstream would catch it. A regression here
      // does not fail at the call site; it fails the whole vitest run from
      // wherever the rejection happens to surface.
      const rejected = Promise.reject(new Error("peer already gone"));
      const unhandled: unknown[] = [];
      const onUnhandled = (err: unknown) => unhandled.push(err);
      process.on("unhandledRejection", onUnhandled);
      try {
        expect(closeAbortedStream({ close: () => rejected })).toBeUndefined();
        // An unhandledRejection fires on a later macrotask, not this one.
        await new Promise((resolve) => setTimeout(resolve, 20));
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
      expect(unhandled).toEqual([]);
    });

    it("returns without waiting on a close that resolves", async () => {
      let closed = false;
      closeAbortedStream({
        close: async () => {
          closed = true;
        },
      });
      await Promise.resolve();
      expect(closed).toBe(true);
    });
  });
});
