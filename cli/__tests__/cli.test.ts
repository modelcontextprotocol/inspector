import { describe, it, beforeAll, afterAll } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliSuccess, expectCliFailure } from "./helpers/assertions.js";
import {
  TEST_SERVER,
  getSampleConfigPath,
  createTestConfig,
  createInvalidConfig,
  deleteConfigFile,
} from "./helpers/fixtures.js";
import { TestServerManager } from "./helpers/test-server.js";

const TEST_CMD = "npx";
const TEST_ARGS = [TEST_SERVER];

describe("CLI Tests", () => {
  const serverManager = new TestServerManager();

  afterAll(() => {
    serverManager.cleanup();
  });

  describe("Basic CLI Mode", () => {
    it("should execute tools/list successfully", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliSuccess(result);
    });

    it("should fail with nonexistent method", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "nonexistent/method",
      ]);

      expectCliFailure(result);
    });

    it("should fail without method", async () => {
      const result = await runCli([TEST_CMD, ...TEST_ARGS, "--cli"]);

      expectCliFailure(result);
    });
  });

  describe("Environment Variables", () => {
    it("should accept environment variables", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "-e",
        "KEY1=value1",
        "-e",
        "KEY2=value2",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliSuccess(result);
    });

    it("should reject invalid environment variable format", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "-e",
        "INVALID_FORMAT",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliFailure(result);
    });

    it("should handle environment variable with equals sign in value", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "-e",
        "API_KEY=abc123=xyz789==",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliSuccess(result);
    });

    it("should handle environment variable with base64-encoded value", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "-e",
        "JWT_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0=",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliSuccess(result);
    });
  });

  describe("Config File", () => {
    it("should use config file with CLI mode", async () => {
      const result = await runCli([
        "--config",
        getSampleConfigPath(),
        "--server",
        "everything",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliSuccess(result);
    });

    it("should fail when using config file without server name", async () => {
      const result = await runCli([
        "--config",
        getSampleConfigPath(),
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliFailure(result);
    });

    it("should fail when using server name without config file", async () => {
      const result = await runCli([
        "--server",
        "everything",
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
        "everything",
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
          "everything",
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
      const result = await runCli([
        "--config",
        getSampleConfigPath(),
        "--server",
        "nonexistent",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliFailure(result);
    });
  });

  describe("Resource Options", () => {
    it("should read resource with URI", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "resources/read",
        "--uri",
        "demo://resource/static/document/architecture.md",
      ]);

      expectCliSuccess(result);
    });

    it("should fail when reading resource without URI", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "resources/read",
      ]);

      expectCliFailure(result);
    });
  });

  describe("Prompt Options", () => {
    it("should get prompt by name", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "prompts/get",
        "--prompt-name",
        "simple-prompt",
      ]);

      expectCliSuccess(result);
    });

    it("should get prompt with arguments", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "prompts/get",
        "--prompt-name",
        "args-prompt",
        "--prompt-args",
        "city=New York",
        "state=NY",
      ]);

      expectCliSuccess(result);
    });

    it("should fail when getting prompt without name", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "prompts/get",
      ]);

      expectCliFailure(result);
    });
  });

  describe("Logging Options", () => {
    it("should set log level", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
        "--cli",
        "--method",
        "logging/setLevel",
        "--log-level",
        "debug",
      ]);

      expectCliSuccess(result);
    });

    it("should reject invalid log level", async () => {
      const result = await runCli([
        TEST_CMD,
        ...TEST_ARGS,
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
      const result = await runCli([
        "--config",
        getSampleConfigPath(),
        "--server",
        "everything",
        "-e",
        "CLI_ENV_VAR=cli_value",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliSuccess(result);
    });

    it("should handle all options together", async () => {
      const result = await runCli([
        "--config",
        getSampleConfigPath(),
        "--server",
        "everything",
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
    });
  });

  describe("Config Transport Types", () => {
    it("should work with stdio transport type", async () => {
      const configPath = createTestConfig({
        mcpServers: {
          "test-stdio": {
            type: "stdio",
            command: "npx",
            args: [TEST_SERVER],
            env: {
              TEST_ENV: "test-value",
            },
          },
        },
      });
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
            note: "Test SSE server",
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
            note: "Test HTTP server",
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
      const configPath = createTestConfig({
        mcpServers: {
          "test-legacy": {
            command: "npx",
            args: [TEST_SERVER],
            env: {
              LEGACY_ENV: "legacy-value",
            },
          },
        },
      });
      try {
        const result = await runCli([
          "--config",
          configPath,
          "--server",
          "test-legacy",
          "--cli",
          "--method",
          "tools/list",
        ]);

        expectCliSuccess(result);
      } finally {
        deleteConfigFile(configPath);
      }
    });
  });

  describe("Default Server Selection", () => {
    it("should auto-select single server", async () => {
      const configPath = createTestConfig({
        mcpServers: {
          "only-server": {
            command: "npx",
            args: [TEST_SERVER],
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
      } finally {
        deleteConfigFile(configPath);
      }
    });

    it("should require explicit server selection even with default-server key (multiple servers)", async () => {
      const configPath = createTestConfig({
        mcpServers: {
          "default-server": {
            command: "npx",
            args: [TEST_SERVER],
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
      const configPath = createTestConfig({
        mcpServers: {
          server1: {
            command: "npx",
            args: [TEST_SERVER],
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
    let httpPort: number;

    beforeAll(async () => {
      // Start HTTP server for these tests - get the actual port used
      const serverInfo = await serverManager.startHttpServer(3001);
      httpPort = serverInfo.port;
      // Give extra time for server to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 2000));
    });

    afterAll(async () => {
      // Cleanup handled by serverManager
      serverManager.cleanup();
      // Give time for cleanup
      await new Promise((resolve) => setTimeout(resolve, 1000));
    });

    it("should infer HTTP transport from URL ending with /mcp", async () => {
      const result = await runCli([
        `http://127.0.0.1:${httpPort}/mcp`,
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliSuccess(result);
    });

    it("should work with explicit --transport http flag", async () => {
      const result = await runCli([
        `http://127.0.0.1:${httpPort}/mcp`,
        "--transport",
        "http",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliSuccess(result);
    });

    it("should work with explicit transport flag and URL suffix", async () => {
      const result = await runCli([
        `http://127.0.0.1:${httpPort}/mcp`,
        "--transport",
        "http",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliSuccess(result);
    });

    it("should fail when SSE transport is given to HTTP server", async () => {
      const result = await runCli([
        `http://127.0.0.1:${httpPort}`,
        "--transport",
        "sse",
        "--cli",
        "--method",
        "tools/list",
      ]);

      expectCliFailure(result);
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
