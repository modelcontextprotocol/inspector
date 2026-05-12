import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliFailure,
  expectOutputContains,
  expectCliSuccess,
} from "./helpers/assertions.js";
import { createTestServerHttp } from "./helpers/test-server-http.js";
import {
  createEchoTool,
  createTestServerInfo,
} from "./helpers/test-fixtures.js";

describe("Header Parsing and Validation", () => {
  describe("Valid Headers", () => {
    it("should parse valid single header and send it to server", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        const port = await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/list",
          "--transport",
          "http",
          "--header",
          "Authorization: Bearer token123",
        ]);

        expectCliSuccess(result);

        // Check that the server received the request with the correct headers
        const recordedRequests = server.getRecordedRequests();
        expect(recordedRequests.length).toBeGreaterThan(0);

        // Find the tools/list request (should be the last one)
        const toolsListRequest = recordedRequests[recordedRequests.length - 1];
        expect(toolsListRequest).toBeDefined();
        expect(toolsListRequest.method).toBe("tools/list");

        // Express normalizes headers to lowercase
        expect(toolsListRequest.headers).toHaveProperty("authorization");
        expect(toolsListRequest.headers?.authorization).toBe("Bearer token123");
      } finally {
        await server.stop();
      }
    });

    it("should parse multiple headers", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        const port = await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/list",
          "--transport",
          "http",
          "--header",
          "Authorization: Bearer token123",
          "--header",
          "X-API-Key: secret123",
        ]);

        expectCliSuccess(result);

        const recordedRequests = server.getRecordedRequests();
        const toolsListRequest = recordedRequests[recordedRequests.length - 1];
        expect(toolsListRequest.method).toBe("tools/list");
        expect(toolsListRequest.headers?.authorization).toBe("Bearer token123");
        expect(toolsListRequest.headers?.["x-api-key"]).toBe("secret123");
      } finally {
        await server.stop();
      }
    });

    it("should handle header with colons in value", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        const port = await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/list",
          "--transport",
          "http",
          "--header",
          "X-Time: 2023:12:25:10:30:45",
        ]);

        expectCliSuccess(result);

        const recordedRequests = server.getRecordedRequests();
        const toolsListRequest = recordedRequests[recordedRequests.length - 1];
        expect(toolsListRequest.method).toBe("tools/list");
        expect(toolsListRequest.headers?.["x-time"]).toBe(
          "2023:12:25:10:30:45",
        );
      } finally {
        await server.stop();
      }
    });

    it("should handle whitespace in headers", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        const port = await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/list",
          "--transport",
          "http",
          "--header",
          "  X-Header  :  value with spaces  ",
        ]);

        expectCliSuccess(result);

        const recordedRequests = server.getRecordedRequests();
        const toolsListRequest = recordedRequests[recordedRequests.length - 1];
        expect(toolsListRequest.method).toBe("tools/list");
        // Header values should be trimmed by the CLI parser
        expect(toolsListRequest.headers?.["x-header"]).toBe(
          "value with spaces",
        );
      } finally {
        await server.stop();
      }
    });
  });

  describe("Invalid Header Formats", () => {
    it("should reject header format without colon", async () => {
      const result = await runCli([
        "https://example.com",
        "--cli",
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--header",
        "InvalidHeader",
      ]);

      expectCliFailure(result);
      expectOutputContains(result, "Invalid header format");
    });

    it("should reject header format with empty name", async () => {
      const result = await runCli([
        "https://example.com",
        "--cli",
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--header",
        ": value",
      ]);

      expectCliFailure(result);
      expectOutputContains(result, "Invalid header format");
    });

    it("should reject header format with empty value", async () => {
      const result = await runCli([
        "https://example.com",
        "--cli",
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--header",
        "Header:",
      ]);

      expectCliFailure(result);
      expectOutputContains(result, "Invalid header format");
    });
  });
});
