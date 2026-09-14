import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { getServerType } from "@inspector/core/mcp/config.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import {
  createProxyFetch,
  readProxyEnv,
} from "@inspector/core/mcp/node/proxyFetch.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
  FetchRequestEntryBase,
} from "@inspector/core/mcp/types.js";
import {
  createTestServerHttp,
  createEchoTool,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import { Client } from "@modelcontextprotocol/client";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

describe("Transport", () => {
  /**
   * Proxy variables are cleared for the WHOLE file, not just the proxy tests.
   *
   * `createProxyFetch`'s `EnvHttpProxyAgent` is memoized process-wide and captures
   * its proxy URLs when it is constructed (only `NO_PROXY` is re-read per
   * request). So on a machine with an ambient `HTTP_PROXY`, any earlier test that
   * makes a real connection would build that agent against the ambient proxy, and
   * a later test setting `HTTP_PROXY` to its own server would be talking to an
   * agent that is not listening. Clearing up front means nothing can build the
   * singleton before the proxy tests do.
   */
  const AMBIENT_PROXY_VARS = [
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "NO_PROXY",
    "no_proxy",
  ] as const;
  const ambientProxyEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const name of AMBIENT_PROXY_VARS) {
      ambientProxyEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterAll(() => {
    for (const name of AMBIENT_PROXY_VARS) {
      const previous = ambientProxyEnv[name];
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  });
  describe("getServerType", () => {
    it("should return stdio for stdio config", () => {
      const config: MCPServerConfig = {
        type: "stdio",
        command: "echo",
        args: ["hello"],
      };
      expect(getServerType(config)).toBe("stdio");
    });

    it("should return sse for sse config", () => {
      const config: MCPServerConfig = {
        type: "sse",
        url: "http://localhost:3000/sse",
      };
      expect(getServerType(config)).toBe("sse");
    });

    it("should return streamable-http for streamable-http config", () => {
      const config: MCPServerConfig = {
        type: "streamable-http",
        url: "http://localhost:3000/mcp",
      };
      expect(getServerType(config)).toBe("streamable-http");
    });

    it("should default to stdio when type is not present", () => {
      const config: MCPServerConfig = {
        command: "echo",
        args: ["hello"],
      };
      expect(getServerType(config)).toBe("stdio");
    });

    it("should throw error for invalid type", () => {
      const config = {
        type: "invalid",
        command: "echo",
      } as unknown as MCPServerConfig;
      expect(() => getServerType(config)).toThrow();
    });
  });

  describe("createTransport", () => {
    it("should create stdio transport", () => {
      const config: MCPServerConfig = {
        type: "stdio",
        command: "echo",
        args: ["hello"],
      };
      const result = createTransportNode(config);
      expect(result.transport).toBeDefined();
    });

    it("should create SSE transport", () => {
      const config: MCPServerConfig = {
        type: "sse",
        url: "http://localhost:3000/sse",
      };
      const result = createTransportNode(config);
      expect(result.transport).toBeDefined();
    });

    it("should create streamable-http transport", () => {
      const config: MCPServerConfig = {
        type: "streamable-http",
        url: "http://localhost:3000/mcp",
      };
      const result = createTransportNode(config);
      expect(result.transport).toBeDefined();
    });

    it("should call onFetchRequest callback for SSE transport", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        serverType: "sse",
      });

      try {
        await server.start();

        const config: MCPServerConfig = {
          type: "sse",
          url: server.url,
        };

        const fetchRequests: FetchRequestEntryBase[] = [];
        const result = createTransportNode(config, {
          onFetchRequest: (entry) => {
            fetchRequests.push(entry);
          },
        });

        expect(result.transport).toBeDefined();

        // Actually connect and make a request to verify fetch tracking works
        const client = new Client(
          {
            name: "test-client",
            version: "1.0.0",
          },
          {
            capabilities: {},
          },
        );

        await client.connect(result.transport);
        await client.listTools();
        await client.close();

        // Verify fetch requests were tracked
        expect(fetchRequests.length).toBeGreaterThan(0);
        // SSE uses GET for the initial connection
        const getRequest = fetchRequests.find((r) => r.method === "GET");
        expect(getRequest).toBeDefined();
        if (getRequest) {
          expect(getRequest.url).toContain("/sse");
          expect(getRequest.requestHeaders).toBeDefined();
        }
      } finally {
        await server.stop();
      }
    });

    it("should call onFetchRequest callback for streamable-http transport", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        serverType: "streamable-http",
      });

      try {
        await server.start();

        const config: MCPServerConfig = {
          type: "streamable-http",
          url: server.url,
        };

        const fetchRequests: FetchRequestEntryBase[] = [];
        const result = createTransportNode(config, {
          onFetchRequest: (entry) => {
            fetchRequests.push(entry);
          },
        });

        expect(result.transport).toBeDefined();

        // Actually connect and make a request to verify fetch tracking works
        const client = new Client(
          {
            name: "test-client",
            version: "1.0.0",
          },
          {
            capabilities: {},
          },
        );

        await client.connect(result.transport);
        await client.listTools();
        await client.close();

        // Verify fetch requests were tracked
        expect(fetchRequests.length).toBeGreaterThan(0);
        const request = fetchRequests[0];
        expect(request).toBeDefined();
        expect(request.url).toContain("/mcp");
        expect(request.method).toBe("POST");
        expect(request.requestHeaders).toBeDefined();
        expect(request.responseStatus).toBeDefined();
        expect(request.responseHeaders).toBeDefined();
        expect(request.duration).toBeDefined();
      } finally {
        await server.stop();
      }
    });

    it("applies settings.headers to the outgoing streamable-http request", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        serverType: "streamable-http",
      });

      try {
        await server.start();

        const config: MCPServerConfig = {
          type: "streamable-http",
          url: server.url,
        };
        const settings: InspectorServerSettings = {
          headers: [
            { key: "X-Tenant", value: "acme" },
            { key: "X-Trace", value: "abc123" },
            { key: "", value: "ignored-empty-key" },
          ],
          env: [],
          metadata: {},
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 0,
          maxFetchRequests: 1000,
          roots: [],
        };

        const fetchRequests: FetchRequestEntryBase[] = [];
        const result = createTransportNode(config, {
          settings,
          onFetchRequest: (entry) => {
            fetchRequests.push(entry);
          },
        });

        const client = new Client(
          { name: "test-client", version: "1.0.0" },
          { capabilities: {} },
        );
        await client.connect(result.transport);
        await client.close();

        // The very first outbound request — the initialize handshake — must
        // already carry settings.headers (acceptance criterion: applied on
        // *first* outbound request, no settings-form open required).
        expect(fetchRequests.length).toBeGreaterThan(0);
        const first = fetchRequests[0];
        const lowered: Record<string, string> = {};
        for (const [k, v] of Object.entries(first?.requestHeaders ?? {})) {
          lowered[k.toLowerCase()] = v;
        }
        expect(lowered["x-tenant"]).toBe("acme");
        expect(lowered["x-trace"]).toBe("abc123");
        // Rows with an empty key are dropped.
        expect(Object.keys(lowered)).not.toContain("");
      } finally {
        await server.stop();
      }
    });

    it("forwards settings.oauthOnInsufficientScope to the streamable-http transport (SEP-2350)", () => {
      const config: MCPServerConfig = {
        type: "streamable-http",
        url: "https://mcp.example.com/mcp",
      };
      const baseSettings: InspectorServerSettings = {
        headers: [],
        env: [],
        metadata: {},
        connectionTimeout: 0,
        requestTimeout: 0,
        taskTtl: 0,
        maxFetchRequests: 1000,
        roots: [],
      };

      const asThrow = createTransportNode(config, {
        settings: { ...baseSettings, oauthOnInsufficientScope: "throw" },
      });
      expect(
        (asThrow.transport as unknown as { _onInsufficientScope?: string })
          ._onInsufficientScope,
      ).toBe("throw");

      // Unset → the SDK's default policy.
      const asDefault = createTransportNode(config, { settings: baseSettings });
      expect(
        (asDefault.transport as unknown as { _onInsufficientScope?: string })
          ._onInsufficientScope,
      ).toBe("reauthorize");
    });

    it("applies settings.headers to the outgoing SSE request", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
        serverType: "sse",
      });

      try {
        await server.start();

        const config: MCPServerConfig = { type: "sse", url: server.url };
        const settings: InspectorServerSettings = {
          headers: [{ key: "X-Tenant", value: "acme" }],
          env: [],
          metadata: {},
          connectionTimeout: 0,
          requestTimeout: 0,
          taskTtl: 0,
          maxFetchRequests: 1000,
          roots: [],
        };

        const fetchRequests: FetchRequestEntryBase[] = [];
        const result = createTransportNode(config, {
          settings,
          onFetchRequest: (entry) => {
            fetchRequests.push(entry);
          },
        });

        const client = new Client(
          { name: "test-client", version: "1.0.0" },
          { capabilities: {} },
        );
        await client.connect(result.transport);
        await client.close();

        // SSE initiates with a GET — that GET must already carry the header.
        expect(fetchRequests.length).toBeGreaterThan(0);
        const getRequest = fetchRequests.find((r) => r.method === "GET");
        expect(getRequest).toBeDefined();
        const lowered: Record<string, string> = {};
        for (const [k, v] of Object.entries(getRequest?.requestHeaders ?? {})) {
          lowered[k.toLowerCase()] = v;
        }
        expect(lowered["x-tenant"]).toBe("acme");
      } finally {
        await server.stop();
      }
    });

    it("omits headers when settings.headers is empty", async () => {
      const config: MCPServerConfig = {
        type: "streamable-http",
        url: "http://localhost:3000/mcp",
      };
      const settings: InspectorServerSettings = {
        headers: [],
        env: [],
        metadata: {},
        connectionTimeout: 0,
        requestTimeout: 0,
        taskTtl: 0,
        maxFetchRequests: 1000,
        roots: [],
      };
      const result = createTransportNode(config, { settings });
      // Just exercise the empty-headers path — no transport construction
      // should throw and no client connection is necessary.
      expect(result.transport).toBeDefined();
    });
  });

  describe("HTTPS_PROXY / HTTP_PROXY", () => {
    const PROXY_VARS = [
      "HTTPS_PROXY",
      "https_proxy",
      "HTTP_PROXY",
      "http_proxy",
      "NO_PROXY",
      "no_proxy",
    ] as const;

    function clearProxyEnv() {
      for (const name of PROXY_VARS) delete process.env[name];
    }

    afterEach(() => {
      clearProxyEnv();
      vi.restoreAllMocks();
    });

    it("readProxyEnv returns undefined with no proxy vars and the first set value otherwise", () => {
      clearProxyEnv();
      expect(readProxyEnv()).toBeUndefined();
      process.env.HTTP_PROXY = "http://proxy.example:3128";
      expect(readProxyEnv()).toBe("http://proxy.example:3128");
      process.env.HTTPS_PROXY = "http://secure-proxy.example:3128";
      // HTTPS_PROXY is checked before HTTP_PROXY
      expect(readProxyEnv()).toBe("http://secure-proxy.example:3128");
      clearProxyEnv();
      process.env.https_proxy = "   ";
      expect(readProxyEnv()).toBeUndefined();
    });

    it("createProxyFetch returns undefined when no proxy is configured", () => {
      clearProxyEnv();
      expect(createProxyFetch()).toBeUndefined();
    });

    it("createProxyFetch returns a fetch when a proxy is configured", () => {
      clearProxyEnv();
      process.env.HTTPS_PROXY = "http://proxy.example:3128";
      expect(typeof createProxyFetch()).toBe("function");
    });

    it("createTransportNode leaves a supplied fetchFn untouched under a proxy", async () => {
      // The proxy now lives at the *bottom* of the stack (environment.fetch), so
      // a caller-supplied fetch must be used verbatim — the old behavior wrapped
      // it and injected a `dispatcher`, which is what #2067 removed.
      clearProxyEnv();
      process.env.HTTPS_PROXY = "http://proxy.example:3128";
      let seenInit: RequestInit | undefined;
      const fetchFn = vi.fn(
        async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          seenInit = init;
          throw new Error("stop");
        },
      );
      const result = createTransportNode(
        { type: "streamable-http", url: "https://example.com/mcp" },
        { fetchFn: fetchFn as unknown as typeof fetch },
      );
      const client = new Client({ name: "t", version: "1" });
      await expect(client.connect(result.transport)).rejects.toThrow();
      expect(fetchFn).toHaveBeenCalled();
      expect(
        (seenInit as { dispatcher?: unknown } | undefined)?.dispatcher,
      ).toBeUndefined();
    });

    describe("through a real proxy server", () => {
      // A forwarding proxy, so these exercise the actual undici code path rather
      // than a mock. That matters: #2067's second bug was a *runtime* interface
      // mismatch between userland undici's dispatcher and Node's built-in fetch
      // ("invalid onRequestStart method"), which every mock-based test missed
      // because no mock ever dispatches. Only a request that really leaves the
      // process can catch that class.
      let proxy: Server;
      let proxyUrl: string;
      let origin: Server;
      let originUrl: string;
      const proxied: string[] = [];
      const seenRequests: Array<{ method: string; probe: string }> = [];

      beforeAll(async () => {
        origin = createServer((req, res) => {
          seenRequests.push({
            method: req.method ?? "",
            probe: String(req.headers["x-probe"] ?? ""),
          });
          if (req.url === "/no-content") {
            res.writeHead(204);
            res.end();
            return;
          }
          if (req.url === "/redirect") {
            res.writeHead(302, { location: `${originUrl}/landed` });
            res.end();
            return;
          }
          res.writeHead(200, { "content-type": "text/plain", "x-origin": "1" });
          res.end("hello from origin");
        });
        await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
        originUrl = `http://127.0.0.1:${(origin.address() as AddressInfo).port}`;

        proxy = createServer((req, res) => {
          // Absolute-form request URI is what makes this a proxy request.
          proxied.push(req.url ?? "");
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
        await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
        proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
      });

      afterAll(async () => {
        await new Promise<void>((r) => proxy.close(() => r()));
        await new Promise<void>((r) => origin.close(() => r()));
      });

      it("routes requests through the proxy and returns a global Response", async () => {
        clearProxyEnv();
        process.env.HTTP_PROXY = proxyUrl;
        const proxyFetch = createProxyFetch();
        expect(proxyFetch).toBeDefined();

        const before = proxied.length;
        const res = await proxyFetch!(`${originUrl}/hello`);

        // The request really went through the proxy...
        expect(proxied.length).toBe(before + 1);
        expect(proxied[proxied.length - 1]).toBe(`${originUrl}/hello`);

        // ...and came back as a *global* Response, not undici's own class. The
        // SDK branches on `input instanceof Response` when formatting OAuth
        // errors, so a foreign Response silently degrades those messages.
        expect(res).toBeInstanceOf(Response);
        expect(res.headers).toBeInstanceOf(Headers);
        expect(res.status).toBe(200);
        expect(res.headers.get("x-origin")).toBe("1");
        expect(await res.text()).toBe("hello from origin");
      });

      it("honors NO_PROXY", async () => {
        clearProxyEnv();
        process.env.HTTP_PROXY = proxyUrl;
        process.env.NO_PROXY = "127.0.0.1";
        const proxyFetch = createProxyFetch();

        const before = proxied.length;
        const res = await proxyFetch!(`${originUrl}/direct`);

        expect(res.status).toBe(200);
        // Went straight to the origin — the proxy never saw it.
        expect(proxied.length).toBe(before);
      });

      it("preserves a null-body status", async () => {
        clearProxyEnv();
        process.env.HTTP_PROXY = proxyUrl;
        const proxyFetch = createProxyFetch();

        const res = await proxyFetch!(`${originUrl}/no-content`);
        expect(res.status).toBe(204);
        expect(res.body).toBeNull();
      });

      it("reports url/redirected/type after following a redirect", async () => {
        // A rebuilt Response cannot carry these through its constructor, so they
        // are reinstated explicitly. Without that, a proxied response reports
        // `url: ""` and `redirected: false` even when undici did follow a
        // redirect — a fetch-contract regression only proxy users would see.
        clearProxyEnv();
        process.env.HTTP_PROXY = proxyUrl;
        const proxyFetch = createProxyFetch();

        const res = await proxyFetch!(`${originUrl}/redirect`);
        expect(res.status).toBe(200);
        expect(res.url).toBe(`${originUrl}/landed`);
        expect(res.redirected).toBe(true);
        expect(res.type).toBe("basic");
      });

      it("honors a Request's own redirect mode", async () => {
        // The Request carries options the adapter must not drop on the way into
        // undici. `redirect: "manual"` is the visible one: lose it and a caller
        // asking to see the 302 silently gets the followed 200 instead.
        clearProxyEnv();
        process.env.HTTP_PROXY = proxyUrl;
        const proxyFetch = createProxyFetch();

        const res = await proxyFetch!(
          new Request(`${originUrl}/redirect`, { redirect: "manual" }),
        );
        expect(res.status).toBe(302);
        expect(res.redirected).toBe(false);
      });

      it("accepts a URL instance and forwards the init", async () => {
        clearProxyEnv();
        process.env.HTTP_PROXY = proxyUrl;
        const proxyFetch = createProxyFetch();

        const res = await proxyFetch!(new URL(`${originUrl}/from-url`), {
          method: "POST",
          headers: { "x-probe": "yes" },
        });
        expect(res.status).toBe(200);
        expect(proxied[proxied.length - 1]).toBe(`${originUrl}/from-url`);
        expect(seenRequests[seenRequests.length - 1]).toMatchObject({
          method: "POST",
          probe: "yes",
        });
      });

      it("accepts a Request as input", async () => {
        clearProxyEnv();
        process.env.HTTP_PROXY = proxyUrl;
        const proxyFetch = createProxyFetch();

        const res = await proxyFetch!(
          new Request(`${originUrl}/from-request`, { method: "GET" }),
        );
        expect(res.status).toBe(200);
        expect(proxied[proxied.length - 1]).toBe(`${originUrl}/from-request`);
      });
    });

    it("reports a packaging fault when undici cannot be loaded", async () => {
      // The message deliberately does NOT tell the user to install undici. It
      // is a root dependency and always present; the only way this branch is
      // reached in a published build is that the bundler mangled the specifier
      // — which is exactly what #2067 was, and the old copy sent every affected
      // user chasing an install that could not have helped.
      clearProxyEnv();
      process.env.HTTPS_PROXY = "http://proxy.example:3128";
      vi.doMock("undici", () => {
        throw new Error("Cannot find module 'undici'");
      });
      // Re-import after the mock so the dynamic import() inside the module is
      // intercepted — and so the module-level agent memo starts out empty.
      vi.resetModules();
      const { createProxyFetch: create } =
        await import("@inspector/core/mcp/node/proxyFetch.js");
      const proxied = create();
      await expect(proxied!("https://example.com")).rejects.toThrow(
        /undici.*could not be loaded/i,
      );
      vi.doUnmock("undici");
      vi.resetModules();
    });
  });
});
