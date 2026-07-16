import { afterEach, describe, it, expect, vi } from "vitest";
import { getServerType } from "@inspector/core/mcp/config.js";
import {
  createTransportNode,
  readProxyEnv,
  withProxyDispatcher,
} from "@inspector/core/mcp/node/transport.js";
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

describe("Transport", () => {
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
          metadata: [],
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
          metadata: [],
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
        metadata: [],
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

    it("withProxyDispatcher returns the original fetch unchanged when no proxy is configured", () => {
      clearProxyEnv();
      const base = vi.fn();
      expect(withProxyDispatcher(base as unknown as typeof fetch)).toBe(base);
    });

    it("withProxyDispatcher injects an EnvHttpProxyAgent dispatcher into RequestInit", async () => {
      clearProxyEnv();
      process.env.HTTPS_PROXY = "http://proxy.example:3128";
      const calls: Array<{
        input: Parameters<typeof fetch>[0];
        init: RequestInit | undefined;
      }> = [];
      const base = vi.fn(
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          calls.push({ input, init });
          return new Response("ok");
        },
      );
      const proxied = withProxyDispatcher(base as unknown as typeof fetch);
      expect(proxied).not.toBe(base);
      await proxied("https://example.com/mcp", { method: "POST" });
      expect(calls).toHaveLength(1);
      expect(calls[0].input).toBe("https://example.com/mcp");
      expect(calls[0].init?.method).toBe("POST");
      const dispatcher = (calls[0].init as { dispatcher?: object }).dispatcher;
      expect(dispatcher).toBeDefined();
      expect(dispatcher?.constructor.name).toBe("EnvHttpProxyAgent");
      // Second call reuses the same dispatcher (lazy singleton).
      await proxied("https://example.com/mcp");
      const dispatcher2 = (calls[1].init as { dispatcher?: object }).dispatcher;
      expect(dispatcher2).toBe(dispatcher);
    });

    it("createTransportNode wraps the supplied fetch with the proxy dispatcher for streamable-http", async () => {
      clearProxyEnv();
      process.env.HTTPS_PROXY = "http://proxy.example:3128";
      let seenDispatcher: object | undefined;
      const fetchFn = vi.fn(
        async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          seenDispatcher = (init as { dispatcher?: object } | undefined)
            ?.dispatcher;
          // Reject after capturing so connect() fails fast without hitting a
          // real proxy.
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
      expect(seenDispatcher?.constructor.name).toBe("EnvHttpProxyAgent");
    });

    it("throws an actionable error when a proxy is configured but undici cannot be loaded", async () => {
      clearProxyEnv();
      process.env.HTTPS_PROXY = "http://proxy.example:3128";
      vi.doMock("undici", () => {
        throw new Error("Cannot find module 'undici'");
      });
      // Re-import after the mock so the dynamic import("undici") inside
      // withProxyDispatcher is intercepted.
      const { withProxyDispatcher: wrap } =
        await import("@inspector/core/mcp/node/transport.js");
      const proxied = wrap(globalThis.fetch);
      await expect(proxied("https://example.com")).rejects.toThrow(
        /HTTPS_PROXY.*undici.*not.*available/i,
      );
      vi.doUnmock("undici");
    });
  });
});
