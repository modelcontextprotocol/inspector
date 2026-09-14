import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import type { StrictJsonObject } from "@inspector/core/json/jsonUtils.js";
import {
  expectCliSuccess,
  expectCliFailure,
  expectValidJson,
} from "./helpers/assertions.js";
import {
  createTestServerHttp,
  createEchoTool,
  createAddTool,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import {
  NO_SERVER_SENTINEL,
  createTestConfig,
  deleteConfigFile,
} from "./helpers/fixtures.js";

describe("Metadata Tests", () => {
  describe("General Metadata", () => {
    it("should work with tools/list", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start();
        const result = await runCli([
          server.url,
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
        await server.start();
        const result = await runCli([
          server.url,
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
            promptString: "test prompt",
          },
        ],
      });

      try {
        await server.start();
        const result = await runCli([
          server.url,
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
        await server.start();
        const result = await runCli([
          server.url,
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
            promptString: "test prompt",
          },
        ],
      });

      try {
        await server.start();
        const result = await runCli([
          server.url,
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
        await server.start();
        const result = await runCli([
          server.url,
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
        await server.start();
        const result = await runCli([
          server.url,
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
        await server.start();
        const result = await runCli([
          server.url,
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
        await server.start();
        const result = await runCli([
          server.url,
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

        // A JSON-parseable value goes out as that JSON type, not as its
        // string spelling (#1910) — `_meta` takes any JSON.
        const recordedRequests = server.getRecordedRequests();
        const toolsListRequest = recordedRequests.find(
          (r) => r.method === "tools/list",
        );
        expect(toolsListRequest).toBeDefined();
        expect(toolsListRequest?.metadata).toEqual({
          integer_value: 42,
          decimal_value: 3.14159,
          negative_value: -10,
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
        await server.start();
        const result = await runCli([
          server.url,
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

    it("sends object/array/boolean metadata as real JSON, not stringified (#1910)", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start();
        const result = await runCli([
          server.url,
          "--cli",
          "--method",
          "tools/list",
          "--metadata",
          'nested={"key":"value"}',
          "list=[1,2,3]",
          "flag=true",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);

        const recordedRequests = server.getRecordedRequests();
        const toolsListRequest = recordedRequests.find(
          (r) => r.method === "tools/list",
        );
        expect(toolsListRequest?.metadata).toEqual({
          nested: { key: "value" },
          list: [1, 2, 3],
          flag: true,
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
        await server.start();
        const result = await runCli([
          server.url,
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
        await server.start();
        const result = await runCli([
          server.url,
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
        await server.start();
        const result = await runCli([
          server.url,
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
        await server.start();
        const result = await runCli([
          server.url,
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
        await server.start();
        const result = await runCli([
          server.url,
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
            promptString: "test prompt",
          },
        ],
      });

      try {
        await server.start();
        const result = await runCli([
          server.url,
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
        await server.start();
        const result = await runCli([
          server.url,
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
        await server.start();
        const result = await runCli([
          server.url,
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
          integration_test: true,
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
        await server.start();
        const result = await runCli([
          server.url,
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
          session_id: 12345,
          user_id: 67890,
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

    it.each([
      ["an overflowing literal", "n=1e400"],
      ["a negative overflow", "n=-1e400"],
      ["one nested in an object", 'o={"a":1e400}'],
    ])("rejects %s rather than sending null", async (_label, pair) => {
      // `JSON.parse` accepts these and yields ±Infinity, which
      // `JSON.stringify` writes as `null` — so accepting the flag would
      // transmit a value the user did not ask for.
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });
      try {
        await server.start();
        const result = await runCli([
          server.url,
          "--cli",
          "--method",
          "tools/list",
          "--metadata",
          pair,
          "--transport",
          "http",
        ]);
        expect(result.exitCode).not.toBe(0);
        expect(`${result.stderr}${result.stdout}`).toMatch(/finite/i);
      } finally {
        await server.stop();
      }
    });

    it("names the key but never the value when rejecting", async () => {
      // The pair can carry a credential, and this message reaches stderr and
      // CI logs.
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });
      try {
        await server.start();
        const result = await runCli([
          server.url,
          "--cli",
          "--method",
          "tools/list",
          "--metadata",
          'credentials={"accessToken":"sk-live-nope","n":1e400}',
          "--transport",
          "http",
        ]);
        const output = `${result.stderr}${result.stdout}`;
        expect(result.exitCode).not.toBe(0);
        expect(output).toContain("credentials");
        expect(output).not.toContain("sk-live");
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
        await server.start();
        const result = await runCli([
          server.url,
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
          numeric_key: 123,
          boolean_key: true,
          json_key: '\'{"test":"value"}\'', // Single quotes are preserved
          special_key: "!@#$%^&*()",
          unicode_key: "🚀🎉✨",
        });
      } finally {
        await server.stop();
      }
    });
  });

  describe("SSE Transport Tests", () => {
    it("should work with tools/list using SSE transport", async () => {
      const server = createTestServerHttp({
        serverType: "sse",
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start();
        const result = await runCli([
          server.url,
          "--cli",
          "--method",
          "tools/list",
          "--metadata",
          "client=test-client",
          "--transport",
          "sse",
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
  });
  describe("Per-server metadata from mcp.json (#2093)", () => {
    /**
     * Write a one-server catalog pointing at `url`, carrying `metadata` as the
     * on-disk per-server key. Returns the catalog path; the caller deletes it.
     */
    function writeCatalogWithMetadata(
      url: string,
      metadata: StrictJsonObject,
    ): string {
      return createTestConfig({
        mcpServers: {
          "meta-server": {
            type: "streamable-http",
            url,
            metadata,
          },
        },
      });
    }

    it("applies a server's persisted metadata to every request", async () => {
      // The setting belongs to the server, not to the client that reads it —
      // web and the TUI already honored it, and the CLI silently did not,
      // because `InspectorClient` reads `defaultMetadata` rather than falling
      // back to `serverSettings.metadata`.
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });
      let catalogPath: string | undefined;

      try {
        await server.start();
        catalogPath = writeCatalogWithMetadata(server.url, { tenant: "acme" });

        const result = await runCli([
          "--catalog",
          catalogPath,
          "--server",
          "meta-server",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliSuccess(result);
        expect(expectValidJson(result)).toHaveProperty("tools");

        const toolsListRequest = server
          .getRecordedRequests()
          .find((r) => r.method === "tools/list");
        expect(toolsListRequest).toBeDefined();
        expect(toolsListRequest?.metadata).toEqual({ tenant: "acme" });
      } finally {
        if (catalogPath) deleteConfigFile(catalogPath);
        await server.stop();
      }
    });

    it("merges --metadata over the persisted defaults", async () => {
      // `--metadata` is per-invocation and stays that way: non-colliding keys
      // merge with the catalog's, and a colliding one wins (call-time keys
      // override defaults in `InspectorClient.mergeMeta`).
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });
      let catalogPath: string | undefined;

      try {
        await server.start();
        catalogPath = writeCatalogWithMetadata(server.url, {
          tenant: "acme",
          region: "eu",
        });

        const result = await runCli([
          "--catalog",
          catalogPath,
          "--server",
          "meta-server",
          "--cli",
          "--method",
          "tools/list",
          "--metadata",
          "tenant=override",
        ]);

        expectCliSuccess(result);

        const toolsListRequest = server
          .getRecordedRequests()
          .find((r) => r.method === "tools/list");
        expect(toolsListRequest?.metadata).toEqual({
          tenant: "override",
          region: "eu",
        });
      } finally {
        if (catalogPath) deleteConfigFile(catalogPath);
        await server.stop();
      }
    });

    it("sends no _meta when the persisted metadata is empty", async () => {
      // `{}` means "no defaults" — an empty map must not put a bare `_meta` on
      // the wire, matching what the option-less CLI has always sent.
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });
      let catalogPath: string | undefined;

      try {
        await server.start();
        catalogPath = writeCatalogWithMetadata(server.url, {});

        const result = await runCli([
          "--catalog",
          catalogPath,
          "--server",
          "meta-server",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliSuccess(result);

        const toolsListRequest = server
          .getRecordedRequests()
          .find((r) => r.method === "tools/list");
        expect(toolsListRequest).toBeDefined();
        expect(toolsListRequest?.metadata).toBeUndefined();
      } finally {
        if (catalogPath) deleteConfigFile(catalogPath);
        await server.stop();
      }
    });
  });
});
