import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliSuccess,
  expectCliFailure,
  expectValidJson,
} from "./helpers/assertions.js";
import {
  NO_SERVER_SENTINEL,
  createSampleTestConfig,
  createTestConfig,
  createInvalidConfig,
  deleteConfigFile,
} from "./helpers/fixtures.js";
import {
  getTestMcpServerCommand,
  createTestServerHttp,
  createEchoTool,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import type { MCPServerConfig } from "@modelcontextprotocol/inspector-core/mcp/index.js";

describe("CLI Tests", () => {
  describe("Basic CLI Mode", () => {
    it("should execute tools/list successfully", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("tools");
      expect(Array.isArray(json.tools)).toBe(true);

      // Validate expected tools from test-mcp-server
      const toolNames = json.tools.map((tool: { name: string }) => tool.name);
      expect(toolNames).toContain("echo");
      expect(toolNames).toContain("get_sum");
      expect(toolNames).toContain("get_annotated_message");
    });

    it("should fail with nonexistent method", async () => {
      const result = await runCli([
        NO_SERVER_SENTINEL,
        "--cli",
        "--method",
        "nonexistent/method",
      ]);

      expectCliFailure(result);
    });

    it("should fail without method", async () => {
      const result = await runCli([NO_SERVER_SENTINEL, "--cli"]);

      expectCliFailure(result);
    });
  });

  describe("Environment Variables", () => {
    it("should accept environment variables", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "-e",
        "KEY1=value1",
        "-e",
        "KEY2=value2",
        "--cli",
        "--method",
        "resources/read",
        "--uri",
        "test://env",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("contents");
      expect(Array.isArray(json.contents)).toBe(true);
      expect(json.contents.length).toBeGreaterThan(0);

      // Parse the env vars from the resource
      const envVars = JSON.parse(json.contents[0].text);
      expect(envVars.KEY1).toBe("value1");
      expect(envVars.KEY2).toBe("value2");
    });

    it("should reject invalid environment variable format", async () => {
      const result = await runCli([
        NO_SERVER_SENTINEL,
        "-e",
        "INVALID_FORMAT",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliFailure(result);
    });

    it("should handle environment variable with equals sign in value", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "-e",
        "API_KEY=abc123=xyz789==",
        "--cli",
        "--method",
        "resources/read",
        "--uri",
        "test://env",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      const envVars = JSON.parse(json.contents[0].text);
      expect(envVars.API_KEY).toBe("abc123=xyz789==");
    });

    it("should handle environment variable with base64-encoded value", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "-e",
        "JWT_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0=",
        "--cli",
        "--method",
        "resources/read",
        "--uri",
        "test://env",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      const envVars = JSON.parse(json.contents[0].text);
      expect(envVars.JWT_TOKEN).toBe(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0=",
      );
    });
  });

  describe("Config File", () => {
    it("should use config file with CLI mode", async () => {
      const configPath = createSampleTestConfig();
      try {
        const result = await runCli([
          "--config",
          configPath,
          "--server",
          "test-stdio",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("tools");
        expect(Array.isArray(json.tools)).toBe(true);
        expect(json.tools.length).toBeGreaterThan(0);
      } finally {
        deleteConfigFile(configPath);
      }
    });

    it("should fail when using config file without server name", async () => {
      const configPath = createSampleTestConfig();
      try {
        const result = await runCli([
          "--config",
          configPath,
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliFailure(result);
      } finally {
        deleteConfigFile(configPath);
      }
    });

    it("should fail when using server name without config file", async () => {
      const result = await runCli([
        "--server",
        "test-stdio",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliFailure(result);
    });

    it("should fail with nonexistent config file", async () => {
      const result = await runCli([
        "--config",
        "./nonexistent-config.json",
        "--server",
        "test-stdio",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliFailure(result);
    });

    it("should fail with invalid config file format", async () => {
      // Create invalid config temporarily
      const invalidConfigPath = createInvalidConfig();
      try {
        const result = await runCli([
          "--config",
          invalidConfigPath,
          "--server",
          "test-stdio",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliFailure(result);
      } finally {
        deleteConfigFile(invalidConfigPath);
      }
    });

    it("should fail with nonexistent server in config", async () => {
      const configPath = createSampleTestConfig();
      try {
        const result = await runCli([
          "--config",
          configPath,
          "--server",
          "nonexistent",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliFailure(result);
      } finally {
        deleteConfigFile(configPath);
      }
    });
  });

  describe("Catalog File", () => {
    it("should use a writable catalog with CLI mode", async () => {
      const catalogPath = createSampleTestConfig();
      try {
        const result = await runCli([
          "--catalog",
          catalogPath,
          "--server",
          "test-stdio",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("tools");
        expect(Array.isArray(json.tools)).toBe(true);
      } finally {
        deleteConfigFile(catalogPath);
      }
    });

    it("should fail when --catalog and --config are combined", async () => {
      const catalogPath = createSampleTestConfig();
      try {
        const result = await runCli([
          "--catalog",
          catalogPath,
          "--config",
          catalogPath,
          "--server",
          "test-stdio",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliFailure(result);
        expect(result.stderr).toMatch(/mutually exclusive/);
      } finally {
        deleteConfigFile(catalogPath);
      }
    });

    it("should fail when --catalog is combined with an ad-hoc target", async () => {
      const catalogPath = createSampleTestConfig();
      const { command, args } = getTestMcpServerCommand();
      try {
        const result = await runCli([
          command,
          ...args,
          "--catalog",
          catalogPath,
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliFailure(result);
        expect(result.stderr).toMatch(/--catalog cannot be combined/);
      } finally {
        deleteConfigFile(catalogPath);
      }
    });
  });

  describe("Config-file settings lifting (#1482)", () => {
    it("applies a config file's custom header on a tools/call over HTTP", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });
      let configPath: string | undefined;
      try {
        await server.start();
        // Write a config whose server carries disk-level headers + a timeout.
        // `headers`/`requestTimeout` are Inspector-extension fields not present
        // on MCPServerConfig, so build the entry as a loose record.
        configPath = createTestConfig({
          mcpServers: {
            web: {
              type: "streamable-http",
              url: server.url,
              headers: { "X-Custom-Token": "secret-123" },
              requestTimeout: 8000,
            } as unknown as MCPServerConfig,
          },
        });

        const result = await runCli([
          "--config",
          configPath,
          "--server",
          "web",
          "--cli",
          "--method",
          "tools/call",
          "--tool-name",
          "echo",
          "--tool-arg",
          "message=hi",
        ]);

        expectCliSuccess(result);
        // The server should have received a request carrying the disk header
        // (Express lower-cases header names), proving the CLI lifted it from
        // the config file into the connection's settings.
        const sawHeader = server
          .getRecordedRequests()
          .some((r) => r.headers["x-custom-token"] === "secret-123");
        expect(sawHeader).toBe(true);
      } finally {
        await server.stop();
        if (configPath) deleteConfigFile(configPath);
      }
    });

    it("overrides a config file's header with --header", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });
      let configPath: string | undefined;
      try {
        await server.start();
        configPath = createTestConfig({
          mcpServers: {
            web: {
              type: "streamable-http",
              url: server.url,
              headers: { "X-Custom-Token": "from-disk" },
            } as unknown as MCPServerConfig,
          },
        });

        const result = await runCli([
          "--config",
          configPath,
          "--server",
          "web",
          "--header",
          "X-Custom-Token: from-cli",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliSuccess(result);
        const tokens = server
          .getRecordedRequests()
          .map((r) => r.headers["x-custom-token"]);
        expect(tokens).toContain("from-cli");
        expect(tokens).not.toContain("from-disk");
      } finally {
        await server.stop();
        if (configPath) deleteConfigFile(configPath);
      }
    });
  });

  describe("Resource Options", () => {
    it("should read resource with URI", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "resources/read",
        "--uri",
        "demo://resource/static/document/architecture.md",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("contents");
      expect(Array.isArray(json.contents)).toBe(true);
      expect(json.contents.length).toBeGreaterThan(0);
      expect(json.contents[0]).toHaveProperty(
        "uri",
        "demo://resource/static/document/architecture.md",
      );
      expect(json.contents[0]).toHaveProperty("mimeType", "text/markdown");
      expect(json.contents[0]).toHaveProperty("text");
      expect(json.contents[0].text).toContain("Architecture Documentation");
    });

    it("should fail when reading resource without URI", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "resources/read",
      ]);

      expectCliFailure(result);
    });
  });

  describe("Prompt Options", () => {
    it("should get prompt by name", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "prompts/get",
        "--prompt-name",
        "simple_prompt",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("messages");
      expect(Array.isArray(json.messages)).toBe(true);
      expect(json.messages.length).toBeGreaterThan(0);
      expect(json.messages[0]).toHaveProperty("role", "user");
      expect(json.messages[0]).toHaveProperty("content");
      expect(json.messages[0].content).toHaveProperty("type", "text");
      expect(json.messages[0].content.text).toBe(
        "This is a simple prompt for testing purposes.",
      );
    });

    it("should get prompt with arguments", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "prompts/get",
        "--prompt-name",
        "args_prompt",
        "--prompt-args",
        "city=New York",
        "state=NY",
      ]);

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json).toHaveProperty("messages");
      expect(Array.isArray(json.messages)).toBe(true);
      expect(json.messages.length).toBeGreaterThan(0);
      expect(json.messages[0]).toHaveProperty("role", "user");
      expect(json.messages[0]).toHaveProperty("content");
      expect(json.messages[0].content).toHaveProperty("type", "text");
      // Verify that the arguments were actually used in the response
      expect(json.messages[0].content.text).toContain("city=New York");
      expect(json.messages[0].content.text).toContain("state=NY");
    });

    it("should fail when getting prompt without name", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "prompts/get",
      ]);

      expectCliFailure(result);
    });
  });

  describe("Logging Options", () => {
    it("should set log level", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        logging: true,
      });

      try {
        await server.start();
        const result = await runCli([
          server.url,
          "--cli",
          "--method",
          "logging/setLevel",
          "--log-level",
          "debug",
          "--transport",
          "http",
        ]);

        expectCliSuccess(result);
        // Validate the response - logging/setLevel should return an empty result
        const json = expectValidJson(result);
        expect(json).toEqual({});

        // Validate that the server actually received and recorded the log level
        expect(server.getCurrentLogLevel()).toBe("debug");
      } finally {
        await server.stop();
      }
    });

    it("should reject invalid log level", async () => {
      const { command, args } = getTestMcpServerCommand();
      const result = await runCli([
        command,
        ...args,
        "--cli",
        "--method",
        "logging/setLevel",
        "--log-level",
        "invalid",
      ]);

      expectCliFailure(result);
    });
  });

  describe("Combined Options", () => {
    it("should handle config file with environment variables", async () => {
      const configPath = createSampleTestConfig();
      try {
        const result = await runCli([
          "--config",
          configPath,
          "--server",
          "test-stdio",
          "-e",
          "CLI_ENV_VAR=cli_value",
          "--cli",
          "--method",
          "resources/read",
          "--uri",
          "test://env",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("contents");
        expect(Array.isArray(json.contents)).toBe(true);
        expect(json.contents.length).toBeGreaterThan(0);

        // Parse the env vars from the resource
        const envVars = JSON.parse(json.contents[0].text);
        expect(envVars).toHaveProperty("CLI_ENV_VAR");
        expect(envVars.CLI_ENV_VAR).toBe("cli_value");
      } finally {
        deleteConfigFile(configPath);
      }
    });

    it("should handle all options together", async () => {
      const configPath = createSampleTestConfig();
      try {
        const result = await runCli([
          "--config",
          configPath,
          "--server",
          "test-stdio",
          "-e",
          "CLI_ENV_VAR=cli_value",
          "--cli",
          "--method",
          "tools/call",
          "--tool-name",
          "echo",
          "--tool-arg",
          "message=Hello",
          "--log-level",
          "debug",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("content");
        expect(Array.isArray(json.content)).toBe(true);
        expect(json.content.length).toBeGreaterThan(0);
        expect(json.content[0]).toHaveProperty("type", "text");
        expect(json.content[0].text).toBe("Echo: Hello");
      } finally {
        deleteConfigFile(configPath);
      }
    });
  });

  describe("Config Transport Types", () => {
    it("should work with stdio transport type", async () => {
      const { command, args } = getTestMcpServerCommand();
      const configPath = createTestConfig({
        mcpServers: {
          "test-stdio": {
            type: "stdio",
            command,
            args,
            env: {
              TEST_ENV: "test-value",
            },
          },
        },
      });
      try {
        // First validate tools/list works
        const toolsResult = await runCli([
          "--config",
          configPath,
          "--server",
          "test-stdio",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliSuccess(toolsResult);
        const toolsJson = expectValidJson(toolsResult);
        expect(toolsJson).toHaveProperty("tools");
        expect(Array.isArray(toolsJson.tools)).toBe(true);
        expect(toolsJson.tools.length).toBeGreaterThan(0);

        // Then validate env vars from config are passed to server
        const envResult = await runCli([
          "--config",
          configPath,
          "--server",
          "test-stdio",
          "--cli",
          "--method",
          "resources/read",
          "--uri",
          "test://env",
        ]);

        expectCliSuccess(envResult);
        const envJson = expectValidJson(envResult);
        const envVars = JSON.parse(envJson.contents[0].text);
        expect(envVars).toHaveProperty("TEST_ENV");
        expect(envVars.TEST_ENV).toBe("test-value");
      } finally {
        deleteConfigFile(configPath);
      }
    });

    it("should fail with SSE transport type in CLI mode (connection error)", async () => {
      const configPath = createTestConfig({
        mcpServers: {
          "test-sse": {
            type: "sse",
            url: "http://localhost:3000/sse",
          },
        },
      });
      try {
        const result = await runCli([
          "--config",
          configPath,
          "--server",
          "test-sse",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliFailure(result);
      } finally {
        deleteConfigFile(configPath);
      }
    });

    it("should fail with HTTP transport type in CLI mode (connection error)", async () => {
      const configPath = createTestConfig({
        mcpServers: {
          "test-http": {
            type: "streamable-http",
            url: "http://localhost:3001/mcp",
          },
        },
      });
      try {
        const result = await runCli([
          "--config",
          configPath,
          "--server",
          "test-http",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliFailure(result);
      } finally {
        deleteConfigFile(configPath);
      }
    });

    it("should work with legacy config without type field", async () => {
      const { command, args } = getTestMcpServerCommand();
      const configPath = createTestConfig({
        mcpServers: {
          "test-legacy": {
            command,
            args,
            env: {
              LEGACY_ENV: "legacy-value",
            },
          },
        },
      });
      try {
        // First validate tools/list works
        const toolsResult = await runCli([
          "--config",
          configPath,
          "--server",
          "test-legacy",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliSuccess(toolsResult);
        const toolsJson = expectValidJson(toolsResult);
        expect(toolsJson).toHaveProperty("tools");
        expect(Array.isArray(toolsJson.tools)).toBe(true);
        expect(toolsJson.tools.length).toBeGreaterThan(0);

        // Then validate env vars from config are passed to server
        const envResult = await runCli([
          "--config",
          configPath,
          "--server",
          "test-legacy",
          "--cli",
          "--method",
          "resources/read",
          "--uri",
          "test://env",
        ]);

        expectCliSuccess(envResult);
        const envJson = expectValidJson(envResult);
        const envVars = JSON.parse(envJson.contents[0].text);
        expect(envVars).toHaveProperty("LEGACY_ENV");
        expect(envVars.LEGACY_ENV).toBe("legacy-value");
      } finally {
        deleteConfigFile(configPath);
      }
    });
  });

  describe("Default Server Selection", () => {
    it("should auto-select single server", async () => {
      const { command, args } = getTestMcpServerCommand();
      const configPath = createTestConfig({
        mcpServers: {
          "only-server": {
            command,
            args,
          },
        },
      });
      try {
        const result = await runCli([
          "--config",
          configPath,
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("tools");
        expect(Array.isArray(json.tools)).toBe(true);
        expect(json.tools.length).toBeGreaterThan(0);
      } finally {
        deleteConfigFile(configPath);
      }
    });

    it("should require explicit server selection even with default-server key (multiple servers)", async () => {
      const { command, args } = getTestMcpServerCommand();
      const configPath = createTestConfig({
        mcpServers: {
          "default-server": {
            command,
            args,
          },
          "other-server": {
            command: "node",
            args: ["other.js"],
          },
        },
      });
      try {
        const result = await runCli([
          "--config",
          configPath,
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliFailure(result);
      } finally {
        deleteConfigFile(configPath);
      }
    });

    it("should require explicit server selection with multiple servers", async () => {
      const { command, args } = getTestMcpServerCommand();
      const configPath = createTestConfig({
        mcpServers: {
          server1: {
            command,
            args,
          },
          server2: {
            command: "node",
            args: ["other.js"],
          },
        },
      });
      try {
        const result = await runCli([
          "--config",
          configPath,
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliFailure(result);
      } finally {
        deleteConfigFile(configPath);
      }
    });
  });

  describe("HTTP Transport", () => {
    it("should infer HTTP transport from URL ending with /mcp", async () => {
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
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("tools");
        expect(Array.isArray(json.tools)).toBe(true);
        expect(json.tools.length).toBeGreaterThan(0);
      } finally {
        await server.stop();
      }
    });

    it("should work with explicit --transport http flag", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start();
        const result = await runCli([
          server.url,
          "--transport",
          "http",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("tools");
        expect(Array.isArray(json.tools)).toBe(true);
        expect(json.tools.length).toBeGreaterThan(0);
      } finally {
        await server.stop();
      }
    });

    it("should work with explicit transport flag and URL suffix", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start();
        const result = await runCli([
          server.url,
          "--transport",
          "http",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliSuccess(result);
        const json = expectValidJson(result);
        expect(json).toHaveProperty("tools");
        expect(Array.isArray(json.tools)).toBe(true);
        expect(json.tools.length).toBeGreaterThan(0);
      } finally {
        await server.stop();
      }
    });

    it("should fail when SSE transport is given to HTTP server", async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo(),
        tools: [createEchoTool()],
      });

      try {
        await server.start();
        const result = await runCli([
          server.url,
          "--transport",
          "sse",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliFailure(result);
      } finally {
        await server.stop();
      }
    });

    it("should fail when HTTP transport is specified without URL", async () => {
      const result = await runCli([
        "--transport",
        "http",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliFailure(result);
    });

    it("should fail when SSE transport is specified without URL", async () => {
      const result = await runCli([
        "--transport",
        "sse",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliFailure(result);
    });
  });
});
