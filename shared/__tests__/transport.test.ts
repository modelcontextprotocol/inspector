import { describe, it, expect } from "vitest";
import { createTransport, getServerType } from "../mcp/transport.js";
import type { MCPServerConfig } from "../mcp/types.js";
import { createTestServerHttp } from "../test/test-server-http.js";
import {
  createEchoTool,
  createTestServerInfo,
} from "../test/test-server-fixtures.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

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
      const result = createTransport(config);
      expect(result.transport).toBeDefined();
    });

    it("should create SSE transport", () => {
      const config: MCPServerConfig = {
        type: "sse",
        url: "http://localhost:3000/sse",
      };
      const result = createTransport(config);
      expect(result.transport).toBeDefined();
    });

    it("should create streamable-http transport", () => {
      const config: MCPServerConfig = {
        type: "streamable-http",
        url: "http://localhost:3000/mcp",
      };
      const result = createTransport(config);
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

        const fetchRequests: any[] = [];
        const result = createTransport(config, {
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

        const fetchRequests: any[] = [];
        const result = createTransport(config, {
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
  });
});
