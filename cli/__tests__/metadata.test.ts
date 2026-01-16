import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliSuccess,
  expectCliFailure,
  expectValidJson,
} from "./helpers/assertions.js";
import { createTestServerHttp } from "./helpers/test-server-http.js";
import {
  createEchoTool,
  createAddTool,
  createTestServerInfo,
} from "./helpers/test-fixtures.js";
import { NO_SERVER_SENTINEL } from "./helpers/fixtures.js";

describe("Metadata Tests", () => {
  describe("General Metadata", () => {
    it("should work with tools/list", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/list",
          "--metadata",
          "client=test-client",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("tools");

        // Validate metadata was sent
        const recordedRequests = server.getRecordedRequests();
        const toolsListRequest = recordedRequests.find(
          (r) => r.method === "tools/list",
        );
        expect(toolsListRequest).toBeDefined();
        expect(toolsListRequest?.metadata).toEqual({ client: "test-client" });
      } finally {
        await server.stop();
      }
    });

    it("should work with resources/list", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [
          {
            uri: "test://resource",
            name: "test-resource",
            text: "test content",
          },
        ],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "resources/list",
          "--metadata",
          "client=test-client",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("resources");

        // Validate metadata was sent
        const recordedRequests = server.getRecordedRequests();
        const resourcesListRequest = recordedRequests.find(
          (r) => r.method === "resources/list",
        );
        expect(resourcesListRequest).toBeDefined();
        expect(resourcesListRequest?.metadata).toEqual({
          client: "test-client",
        });
      } finally {
        await server.stop();
      }
    });

    it("should work with prompts/list", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: [
          {
            name: "test-prompt",
            description: "A test prompt",
          },
        ],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "prompts/list",
          "--metadata",
          "client=test-client",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("prompts");

        // Validate metadata was sent
        const recordedRequests = server.getRecordedRequests();
        const promptsListRequest = recordedRequests.find(
          (r) => r.method === "prompts/list",
        );
        expect(promptsListRequest).toBeDefined();
        expect(promptsListRequest?.metadata).toEqual({
          client: "test-client",
        });
      } finally {
        await server.stop();
      }
    });

    it("should work with resources/read", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [
          {
            uri: "test://resource",
            name: "test-resource",
            text: "test content",
          },
        ],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "resources/read",
          "--uri",
          "test://resource",
          "--metadata",
          "client=test-client",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("contents");

        // Validate metadata was sent
        const recordedRequests = server.getRecordedRequests();
        const readRequest = recordedRequests.find(
          (r) => r.method === "resources/read",
        );
        expect(readRequest).toBeDefined();
        expect(readRequest?.metadata).toEqual({ client: "test-client" });
      } finally {
        await server.stop();
      }
    });

    it("should work with prompts/get", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: [
          {
            name: "test-prompt",
            description: "A test prompt",
          },
        ],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "prompts/get",
          "--prompt-name",
          "test-prompt",
          "--metadata",
          "client=test-client",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("messages");

        // Validate metadata was sent
        const recordedRequests = server.getRecordedRequests();
        const getPromptRequest = recordedRequests.find(
          (r) => r.method === "prompts/get",
        );
        expect(getPromptRequest).toBeDefined();
        expect(getPromptRequest?.metadata).toEqual({ client: "test-client" });
      } finally {
        await server.stop();
      }
    });
  });

  describe("Tool-Specific Metadata", () => {
    it("should work with tools/call", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/call",
          "--tool-name",
          "echo",
          "--tool-arg",
          "message=hello world",
          "--tool-metadata",
          "client=test-client",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("content");

        // Validate metadata was sent
        const recordedRequests = server.getRecordedRequests();
        const toolCallRequest = recordedRequests.find(
          (r) => r.method === "tools/call",
        );
        expect(toolCallRequest).toBeDefined();
        expect(toolCallRequest?.metadata).toEqual({ client: "test-client" });
      } finally {
        await server.stop();
      }
    });

    it("should work with complex tool", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createAddTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/call",
          "--tool-name",
          "add",
          "--tool-arg",
          "a=10",
          "b=20",
          "--tool-metadata",
          "client=test-client",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("content");

        // Validate metadata was sent
        const recordedRequests = server.getRecordedRequests();
        const toolCallRequest = recordedRequests.find(
          (r) => r.method === "tools/call",
        );
        expect(toolCallRequest).toBeDefined();
        expect(toolCallRequest?.metadata).toEqual({ client: "test-client" });
      } finally {
        await server.stop();
      }
    });
  });

  describe("Metadata Merging", () => {
    it("should merge general and tool-specific metadata (tool-specific overrides)", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/call",
          "--tool-name",
          "echo",
          "--tool-arg",
          "message=hello world",
          "--metadata",
          "client=general-client",
          "shared_key=shared_value",
          "--tool-metadata",
          "client=tool-specific-client",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate metadata was merged correctly (tool-specific overrides general)
        const recordedRequests = server.getRecordedRequests();
        const toolCallRequest = recordedRequests.find(
          (r) => r.method === "tools/call",
        );
        expect(toolCallRequest).toBeDefined();
        expect(toolCallRequest?.metadata).toEqual({
          client: "tool-specific-client", // Tool-specific overrides general
          shared_key: "shared_value", // General metadata is preserved
        });
      } finally {
        await server.stop();
      }
    });
  });

  describe("Metadata Parsing", () => {
    it("should handle numeric values", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/list",
          "--metadata",
          "integer_value=42",
          "decimal_value=3.14159",
          "negative_value=-10",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate metadata values are sent as strings
        const recordedRequests = server.getRecordedRequests();
        const toolsListRequest = recordedRequests.find(
          (r) => r.method === "tools/list",
        );
        expect(toolsListRequest).toBeDefined();
        expect(toolsListRequest?.metadata).toEqual({
          integer_value: "42",
          decimal_value: "3.14159",
          negative_value: "-10",
        });
      } finally {
        await server.stop();
      }
    });

    it("should handle JSON values", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/list",
          "--metadata",
          'json_object="{\\"key\\":\\"value\\"}"',
          'json_array="[1,2,3]"',
          'json_string="\\"quoted\\""',
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate JSON values are sent as strings
        const recordedRequests = server.getRecordedRequests();
        const toolsListRequest = recordedRequests.find(
          (r) => r.method === "tools/list",
        );
        expect(toolsListRequest).toBeDefined();
        expect(toolsListRequest?.metadata).toEqual({
          json_object: '{"key":"value"}',
          json_array: "[1,2,3]",
          json_string: '"quoted"',
        });
      } finally {
        await server.stop();
      }
    });

    it("should handle special characters", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/list",
          "--metadata",
          "unicode=🚀🎉✨",
          "special_chars=!@#$%^&*()",
          "spaces=hello world with spaces",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate special characters are preserved
        const recordedRequests = server.getRecordedRequests();
        const toolsListRequest = recordedRequests.find(
          (r) => r.method === "tools/list",
        );
        expect(toolsListRequest).toBeDefined();
        expect(toolsListRequest?.metadata).toEqual({
          unicode: "🚀🎉✨",
          special_chars: "!@#$%^&*()",
          spaces: "hello world with spaces",
        });
      } finally {
        await server.stop();
      }
    });
  });

  describe("Metadata Edge Cases", () => {
    it("should handle single metadata entry", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/list",
          "--metadata",
          "single_key=single_value",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate single metadata entry
        const recordedRequests = server.getRecordedRequests();
        const toolsListRequest = recordedRequests.find(
          (r) => r.method === "tools/list",
        );
        expect(toolsListRequest).toBeDefined();
        expect(toolsListRequest?.metadata).toEqual({
          single_key: "single_value",
        });
      } finally {
        await server.stop();
      }
    });

    it("should handle many metadata entries", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/list",
          "--metadata",
          "key1=value1",
          "key2=value2",
          "key3=value3",
          "key4=value4",
          "key5=value5",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate all metadata entries
        const recordedRequests = server.getRecordedRequests();
        const toolsListRequest = recordedRequests.find(
          (r) => r.method === "tools/list",
        );
        expect(toolsListRequest).toBeDefined();
        expect(toolsListRequest?.metadata).toEqual({
          key1: "value1",
          key2: "value2",
          key3: "value3",
          key4: "value4",
          key5: "value5",
        });
      } finally {
        await server.stop();
      }
    });
  });

  describe("Metadata Error Cases", () => {
    it("should fail with invalid metadata format (missing equals)", async () => {
      const result = await runCli([
        NO_SERVER_SENTINEL,
        "--cli",
        "--method",
        "tools/list",
        "--metadata",
        "invalid_format_no_equals",
      ]);

      expectCliFailure(result);
    });

    it("should fail with invalid tool-metadata format (missing equals)", async () => {
      const result = await runCli([
        NO_SERVER_SENTINEL,
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=test",
        "--tool-metadata",
        "invalid_format_no_equals",
      ]);

      expectCliFailure(result);
    });
  });

  describe("Metadata Impact", () => {
    it("should handle tool-specific metadata precedence over general", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/call",
          "--tool-name",
          "echo",
          "--tool-arg",
          "message=precedence test",
          "--metadata",
          "client=general-client",
          "--tool-metadata",
          "client=tool-specific-client",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate tool-specific metadata overrides general
        const recordedRequests = server.getRecordedRequests();
        const toolCallRequest = recordedRequests.find(
          (r) => r.method === "tools/call",
        );
        expect(toolCallRequest).toBeDefined();
        expect(toolCallRequest?.metadata).toEqual({
          client: "tool-specific-client",
        });
      } finally {
        await server.stop();
      }
    });

    it("should work with resources methods", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        resources: [
          {
            uri: "test://resource",
            name: "test-resource",
            text: "test content",
          },
        ],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "resources/list",
          "--metadata",
          "resource_client=test-resource-client",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate metadata was sent
        const recordedRequests = server.getRecordedRequests();
        const resourcesListRequest = recordedRequests.find(
          (r) => r.method === "resources/list",
        );
        expect(resourcesListRequest).toBeDefined();
        expect(resourcesListRequest?.metadata).toEqual({
          resource_client: "test-resource-client",
        });
      } finally {
        await server.stop();
      }
    });

    it("should work with prompts methods", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        prompts: [
          {
            name: "test-prompt",
            description: "A test prompt",
          },
        ],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "prompts/get",
          "--prompt-name",
          "test-prompt",
          "--metadata",
          "prompt_client=test-prompt-client",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate metadata was sent
        const recordedRequests = server.getRecordedRequests();
        const getPromptRequest = recordedRequests.find(
          (r) => r.method === "prompts/get",
        );
        expect(getPromptRequest).toBeDefined();
        expect(getPromptRequest?.metadata).toEqual({
          prompt_client: "test-prompt-client",
        });
      } finally {
        await server.stop();
      }
    });
  });

  describe("Metadata Validation", () => {
    it("should handle special characters in keys", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/call",
          "--tool-name",
          "echo",
          "--tool-arg",
          "message=special keys test",
          "--metadata",
          "key-with-dashes=value1",
          "key_with_underscores=value2",
          "key.with.dots=value3",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate special characters in keys are preserved
        const recordedRequests = server.getRecordedRequests();
        const toolCallRequest = recordedRequests.find(
          (r) => r.method === "tools/call",
        );
        expect(toolCallRequest).toBeDefined();
        expect(toolCallRequest?.metadata).toEqual({
          "key-with-dashes": "value1",
          key_with_underscores: "value2",
          "key.with.dots": "value3",
        });
      } finally {
        await server.stop();
      }
    });
  });

  describe("Metadata Integration", () => {
    it("should work with all MCP methods", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/list",
          "--metadata",
          "integration_test=true",
          "test_phase=all_methods",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate metadata was sent
        const recordedRequests = server.getRecordedRequests();
        const toolsListRequest = recordedRequests.find(
          (r) => r.method === "tools/list",
        );
        expect(toolsListRequest).toBeDefined();
        expect(toolsListRequest?.metadata).toEqual({
          integration_test: "true",
          test_phase: "all_methods",
        });
      } finally {
        await server.stop();
      }
    });

    it("should handle complex metadata scenario", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/call",
          "--tool-name",
          "echo",
          "--tool-arg",
          "message=complex test",
          "--metadata",
          "session_id=12345",
          "user_id=67890",
          "timestamp=2024-01-01T00:00:00Z",
          "request_id=req-abc-123",
          "--tool-metadata",
          "tool_session=session-xyz-789",
          "execution_context=test",
          "priority=high",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate complex metadata merging
        const recordedRequests = server.getRecordedRequests();
        const toolCallRequest = recordedRequests.find(
          (r) => r.method === "tools/call",
        );
        expect(toolCallRequest).toBeDefined();
        expect(toolCallRequest?.metadata).toEqual({
          session_id: "12345",
          user_id: "67890",
          timestamp: "2024-01-01T00:00:00Z",
          request_id: "req-abc-123",
          tool_session: "session-xyz-789",
          execution_context: "test",
          priority: "high",
        });
      } finally {
        await server.stop();
      }
    });

    it("should handle metadata parsing validation", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start("http");
        const serverUrl = `${server.getUrl()}/mcp`;

        const result = await runCli([
          serverUrl,
          "--cli",
          "--method",
          "tools/call",
          "--tool-name",
          "echo",
          "--tool-arg",
          "message=parsing validation test",
          "--metadata",
          "valid_key=valid_value",
          "numeric_key=123",
          "boolean_key=true",
          'json_key=\'{"test":"value"}\'',
          "special_key=!@#$%^&*()",
          "unicode_key=🚀🎉✨",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        // Validate all value types are sent as strings
        // Note: The CLI parses metadata values, so single-quoted JSON strings
        // are preserved with their quotes
        const recordedRequests = server.getRecordedRequests();
        const toolCallRequest = recordedRequests.find(
          (r) => r.method === "tools/call",
        );
        expect(toolCallRequest).toBeDefined();
        expect(toolCallRequest?.metadata).toEqual({
          valid_key: "valid_value",
          numeric_key: "123",
          boolean_key: "true",
          json_key: '\'{"test":"value"}\'', // Single quotes are preserved
          special_key: "!@#$%^&*()",
          unicode_key: "🚀🎉✨",
        });
      } finally {
        await server.stop();
      }
    });
  });
});
