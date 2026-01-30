/**
 * ci-debugging.test.ts
 *
 * Tests for CLI behaviors that matter when used as a CI debugging tool:
 *   - discover command (capability enumeration)
 *   - --structured output envelope
 *   - Server log capture
 *   - --fail-on-error exit code semantics
 *   - ping method
 *   - Capability gating
 *   - resources/list and resources/templates/list (previously zero coverage)
 *   - SSE transport success paths (previously only failure-path tested)
 */

import { describe, it, expect } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliSuccess,
  expectCliFailure,
  expectValidJson,
} from "./helpers/assertions.js";
import { getTestMcpServerCommand } from "./helpers/test-server-stdio.js";
import { createTestServerHttp } from "./helpers/test-server-http.js";
import {
  createEchoTool,
  createTestServerInfo,
  createArchitectureResource,
  createTestEnvResource,
  createSimplePrompt,
} from "./helpers/test-fixtures.js";

/** Builds args for stdio: [command, ...cmdArgs, "--cli", ...flags] */
function stdioCliArgs(...flags: string[]): string[] {
  const { command, args } = getTestMcpServerCommand();
  return [command, ...args, "--cli", ...flags];
}

/** Builds args for HTTP: [url, "--cli", "--transport", "http", ...flags] */
function httpCliArgs(url: string, ...flags: string[]): string[] {
  return [url, "--cli", "--transport", "http", ...flags];
}

/** Builds args for SSE: [url, "--cli", "--transport", "sse", ...flags] */
function sseCliArgs(url: string, ...flags: string[]): string[] {
  return [url, "--cli", "--transport", "sse", ...flags];
}

// ---------------------------------------------------------------------------
// 1. discover command
// ---------------------------------------------------------------------------
describe("CI Debugging: discover", () => {
  it("should return full server shape via stdio", async () => {
    const result = await runCli(stdioCliArgs("--method", "discover"));

    expectCliSuccess(result);
    const json = expectValidJson(result);

    expect(json).toHaveProperty("serverInfo");
    expect(json.serverInfo.name).toBe("test-mcp-server");

    expect(json).toHaveProperty("capabilities");
    expect(json.capabilities.tools).toBe(true);
    expect(json.capabilities.resources).toBe(true);
    expect(json.capabilities.prompts).toBe(true);

    expect(json).toHaveProperty("tools");
    expect(Array.isArray(json.tools)).toBe(true);
    expect(json.tools.length).toBeGreaterThan(0);

    expect(json).toHaveProperty("resources");
    expect(Array.isArray(json.resources)).toBe(true);
    expect(json.resources.length).toBeGreaterThan(0);

    expect(json).toHaveProperty("prompts");
    expect(Array.isArray(json.prompts)).toBe(true);
    expect(json.prompts.length).toBeGreaterThan(0);
  }, 15000);

  it("should return discover via HTTP transport", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("http-discover-server", "2.0.0"),
      tools: [createEchoTool()],
      resources: [createArchitectureResource()],
      prompts: [createSimplePrompt()],
    });

    try {
      await server.start("http");

      const result = await runCli(
        httpCliArgs(`${server.getUrl()}/mcp`, "--method", "discover"),
      );

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json.serverInfo.name).toBe("http-discover-server");
      expect(json.capabilities.tools).toBe(true);
      expect(json.tools.length).toBe(1);
      expect(json.tools[0].name).toBe("echo");
    } finally {
      await server.stop();
    }
  });

  it("should reflect absent capabilities accurately", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("tools-only"),
      tools: [createEchoTool()],
    });

    try {
      await server.start("http");

      const result = await runCli(
        httpCliArgs(`${server.getUrl()}/mcp`, "--method", "discover"),
      );

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json.capabilities.tools).toBe(true);
      expect(json.capabilities.resources).toBe(false);
      expect(json.capabilities.prompts).toBe(false);
      expect(json.tools.length).toBe(1);
      expect(json.resources).toHaveLength(0);
      expect(json.prompts).toHaveLength(0);
    } finally {
      await server.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. ping method
// ---------------------------------------------------------------------------
describe("CI Debugging: ping", () => {
  it("should ping a stdio server successfully", async () => {
    const result = await runCli(stdioCliArgs("--method", "ping"));

    expectCliSuccess(result);
    const json = expectValidJson(result);
    expect(typeof json).toBe("object");
  });

  it("should ping an HTTP server successfully", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });

    try {
      await server.start("http");

      const result = await runCli(
        httpCliArgs(`${server.getUrl()}/mcp`, "--method", "ping"),
      );

      expectCliSuccess(result);
      expectValidJson(result);
    } finally {
      await server.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. --structured output envelope
// ---------------------------------------------------------------------------
describe("CI Debugging: --structured output", () => {
  it("should return structured envelope on success", async () => {
    const result = await runCli(
      stdioCliArgs("--method", "tools/list", "--structured"),
    );

    expectCliSuccess(result);
    const json = expectValidJson(result);

    expect(json.structuredVersion).toBe(1);
    expect(json.success).toBe(true);
    expect(json.method).toBe("tools/list");
    expect(typeof json.durationMs).toBe("number");
    expect(json.durationMs).toBeGreaterThanOrEqual(0);
    expect(json.result).toBeTruthy();
    expect(json.result.tools).toBeDefined();
    expect(json.error).toBeNull();
    expect(Array.isArray(json.logs)).toBe(true);
  });

  it("should return structured envelope with error on transport failure", async () => {
    const result = await runCli(
      httpCliArgs(
        "http://localhost:19999/mcp",
        "--method",
        "tools/list",
        "--structured",
      ),
      { timeout: 8000 },
    );

    expect(result.exitCode).toBe(1);
    const json = expectValidJson(result);

    expect(json.structuredVersion).toBe(1);
    expect(json.success).toBe(false);
    expect(json.error).toBeTruthy();
    expect(json.error.category).toBe("transport");
    expect(json.error.code).toBe("TRANSPORT_ERROR");
    expect(typeof json.error.message).toBe("string");
    expect(json.error.message.length).toBeGreaterThan(0);
  });

  it("should include logs array in structured output", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
      logging: true,
    });

    try {
      await server.start("http");

      const result = await runCli(
        httpCliArgs(
          `${server.getUrl()}/mcp`,
          "--method",
          "tools/list",
          "--structured",
        ),
      );

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(Array.isArray(json.logs)).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it("should return capability error in structured envelope", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("no-resources"),
      tools: [createEchoTool()],
    });

    try {
      await server.start("http");

      const result = await runCli(
        httpCliArgs(
          `${server.getUrl()}/mcp`,
          "--method",
          "resources/list",
          "--structured",
        ),
      );

      expect(result.exitCode).toBe(1);
      const json = expectValidJson(result);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("capability");
      expect(json.error.message).toContain("resources");
    } finally {
      await server.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. --fail-on-error exit code semantics
// ---------------------------------------------------------------------------
describe("CI Debugging: --fail-on-error", () => {
  it("should exit 0 on server tool error without --fail-on-error", async () => {
    const result = await runCli(
      stdioCliArgs(
        "--method",
        "tools/call",
        "--tool-name",
        "nonexistent-tool-xyz",
        "--tool-arg",
        "x=1",
      ),
    );

    expect(result.exitCode).toBe(0);
    const json = expectValidJson(result);
    expect(json.isError).toBe(true);
  });

  it("should exit 1 on server tool error with --fail-on-error", async () => {
    const result = await runCli(
      stdioCliArgs(
        "--method",
        "tools/call",
        "--tool-name",
        "nonexistent-tool-xyz",
        "--tool-arg",
        "x=1",
        "--fail-on-error",
      ),
    );

    expect(result.exitCode).toBe(1);
  });

  it("should exit 0 on successful tool call with --fail-on-error", async () => {
    const result = await runCli(
      stdioCliArgs(
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=hello",
        "--fail-on-error",
      ),
    );

    expectCliSuccess(result);
  });
});

// ---------------------------------------------------------------------------
// 5. Capability gating
// ---------------------------------------------------------------------------
describe("CI Debugging: capability gating", () => {
  it("should fail with capability error when server lacks resources", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("tools-only-gate"),
      tools: [createEchoTool()],
    });

    try {
      await server.start("http");

      const result = await runCli(
        httpCliArgs(`${server.getUrl()}/mcp`, "--method", "resources/list"),
      );

      expectCliFailure(result);
      expect(result.stderr).toContain("resources");
      expect(result.stderr).toContain("does not support");
    } finally {
      await server.stop();
    }
  });

  it("should fail with capability error when server lacks prompts", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("tools-only-prompts"),
      tools: [createEchoTool()],
    });

    try {
      await server.start("http");

      const result = await runCli(
        httpCliArgs(`${server.getUrl()}/mcp`, "--method", "prompts/list"),
      );

      expectCliFailure(result);
      expect(result.stderr).toContain("prompts");
    } finally {
      await server.stop();
    }
  });

  it("should allow discover and ping on any server regardless of capabilities", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("minimal"),
      tools: [createEchoTool()],
    });

    try {
      await server.start("http");

      const discoverResult = await runCli(
        httpCliArgs(`${server.getUrl()}/mcp`, "--method", "discover"),
      );
      expectCliSuccess(discoverResult);

      const pingResult = await runCli(
        httpCliArgs(`${server.getUrl()}/mcp`, "--method", "ping"),
      );
      expectCliSuccess(pingResult);
    } finally {
      await server.stop();
    }
  }, 15000);
});

// ---------------------------------------------------------------------------
// 6. resources/list — previously zero test coverage
// ---------------------------------------------------------------------------
describe("CI Debugging: resources/list", () => {
  it("should list resources via stdio transport", async () => {
    const result = await runCli(stdioCliArgs("--method", "resources/list"));

    expectCliSuccess(result);
    const json = expectValidJson(result);
    expect(json).toHaveProperty("resources");
    expect(Array.isArray(json.resources)).toBe(true);
    expect(json.resources.length).toBeGreaterThanOrEqual(4);

    const uris = json.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain("demo://resource/static/document/architecture.md");
    expect(uris).toContain("test://env");
  });

  it("should list resources via HTTP transport", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      resources: [createArchitectureResource(), createTestEnvResource()],
    });

    try {
      await server.start("http");

      const result = await runCli(
        httpCliArgs(`${server.getUrl()}/mcp`, "--method", "resources/list"),
      );

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json.resources.length).toBe(2);
    } finally {
      await server.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. resources/templates/list — previously zero test coverage
// ---------------------------------------------------------------------------
describe("CI Debugging: resources/templates/list", () => {
  it("should return template list via stdio", async () => {
    const result = await runCli(
      stdioCliArgs("--method", "resources/templates/list"),
    );

    expectCliSuccess(result);
    const json = expectValidJson(result);
    expect(json).toHaveProperty("resourceTemplates");
    expect(Array.isArray(json.resourceTemplates)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. SSE transport success paths — previously only failure tested
// ---------------------------------------------------------------------------
describe("CI Debugging: SSE transport success", () => {
  it("should list tools over SSE", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("sse-tools"),
      tools: [createEchoTool()],
    });

    try {
      await server.start("sse");

      const result = await runCli(
        sseCliArgs(`${server.getUrl()}/mcp`, "--method", "tools/list"),
      );

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json.tools.length).toBeGreaterThan(0);
      expect(json.tools[0].name).toBe("echo");
    } finally {
      await server.stop();
    }
  });

  it("should call a tool over SSE", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("sse-call"),
      tools: [createEchoTool()],
    });

    try {
      await server.start("sse");

      const result = await runCli(
        sseCliArgs(
          `${server.getUrl()}/mcp`,
          "--method",
          "tools/call",
          "--tool-name",
          "echo",
          "--tool-arg",
          "message=hello from SSE",
        ),
      );

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json.content).toBeDefined();
    } finally {
      await server.stop();
    }
  });

  it("should discover over SSE", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("sse-discover", "3.0.0"),
      tools: [createEchoTool()],
      prompts: [createSimplePrompt()],
    });

    try {
      await server.start("sse");

      const result = await runCli(
        sseCliArgs(`${server.getUrl()}/mcp`, "--method", "discover"),
      );

      expectCliSuccess(result);
      const json = expectValidJson(result);
      expect(json.serverInfo.name).toBe("sse-discover");
      expect(json.capabilities.tools).toBe(true);
      expect(json.capabilities.prompts).toBe(true);
    } finally {
      await server.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Multi-step CI flow: discover then call
// ---------------------------------------------------------------------------
describe("CI Debugging: multi-step discover-then-call", () => {
  it("should discover tools then call one in sequence", async () => {
    const { command, args } = getTestMcpServerCommand();

    // Step 1: discover
    const discoverResult = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "discover",
    ]);
    expectCliSuccess(discoverResult);
    const discoverJson = expectValidJson(discoverResult);
    const toolNames = discoverJson.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("echo");

    // Step 2: call discovered tool
    const callResult = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-arg",
      "message=ci-flow-test",
    ]);
    expectCliSuccess(callResult);
    const callJson = expectValidJson(callResult);
    expect(callJson.content[0].text).toBe("Echo: ci-flow-test");
  }, 15000);

  it("should discover resources then read one", async () => {
    const { command, args } = getTestMcpServerCommand();

    // Step 1: discover
    const discoverResult = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "discover",
    ]);
    expectCliSuccess(discoverResult);
    const discoverJson = expectValidJson(discoverResult);
    const archResource = discoverJson.resources.find(
      (r: { uri: string }) =>
        r.uri === "demo://resource/static/document/architecture.md",
    );
    expect(archResource).toBeDefined();

    // Step 2: read
    const readResult = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "resources/read",
      "--uri",
      archResource.uri,
    ]);
    expectCliSuccess(readResult);
    const readJson = expectValidJson(readResult);
    expect(readJson.contents[0].text).toContain("Architecture Documentation");
  }, 15000);
});
