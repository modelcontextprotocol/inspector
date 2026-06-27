import { describe, it, expect, vi, afterEach } from "vitest";
import * as runner from "@inspector/core/client/runner.js";
import {
  createTestServerHttp,
  createEchoTool,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliFailure,
  expectCliSuccess,
  expectOutputContains,
} from "./helpers/assertions.js";
import {
  createClientConfigFile,
  deleteClientConfigFile,
} from "./helpers/fixtures.js";

/**
 * Covers OAuth runner flag wiring in `src/cli.ts` (#1514): --client-config,
 * --client-id/--client-secret/--client-metadata-url, and --callback-url /
 * MCP_OAUTH_CALLBACK_URL. Shared auth logic is unit-tested in
 * clients/web/src/test/core/client/runner.test.ts; these assert the CLI
 * parses flags and passes them through on HTTP (OAuth-capable) connects.
 */
describe("CLI OAuth runner flags", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects over HTTP with OAuth CLI overrides and custom callback URL", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });
    const buildSpy = vi.spyOn(runner, "buildRunnerClientAuthOptions");

    try {
      await server.start();
      const result = await runCli([
        server.url,
        "--cli",
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--client-id",
        "test-client-id",
        "--client-secret",
        "test-client-secret",
        "--client-metadata-url",
        "https://example.com/oauth/client-metadata.json",
        "--callback-url",
        "http://127.0.0.1:9999/oauth/callback",
      ]);

      expectCliSuccess(result);
      expect(buildSpy).toHaveBeenCalled();
      expect(buildSpy.mock.calls[0]?.[2]).toEqual({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        clientMetadataUrl: "https://example.com/oauth/client-metadata.json",
      });
    } finally {
      await server.stop();
    }
  });

  it("loads install client.json from --client-config and prefers CLI CIMD override", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });
    const buildSpy = vi.spyOn(runner, "buildRunnerClientAuthOptions");
    const clientConfigPath = createClientConfigFile({
      cimd: {
        enabled: true,
        clientMetadataUrl: "https://example.com/from-client-json.json",
      },
    });

    try {
      await server.start();
      const result = await runCli([
        server.url,
        "--cli",
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--client-config",
        clientConfigPath,
        "--client-metadata-url",
        "https://example.com/from-cli-flag.json",
      ]);

      expectCliSuccess(result);
      expect(buildSpy).toHaveBeenCalled();
      expect(buildSpy.mock.calls[0]?.[0]).toMatchObject({
        cimd: {
          enabled: true,
          clientMetadataUrl: "https://example.com/from-client-json.json",
        },
      });
      expect(buildSpy.mock.calls[0]?.[2]).toEqual({
        clientMetadataUrl: "https://example.com/from-cli-flag.json",
      });
    } finally {
      await server.stop();
      deleteClientConfigFile(clientConfigPath);
    }
  });

  it("accepts port 0 callback URL for ephemeral listener binding", async () => {
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
        "--transport",
        "http",
        "--callback-url",
        "http://127.0.0.1:0/oauth/callback",
      ]);

      expectCliSuccess(result);
    } finally {
      await server.stop();
    }
  });

  it("uses MCP_OAUTH_CALLBACK_URL when --callback-url is absent", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });

    try {
      await server.start();
      const result = await runCli(
        [
          server.url,
          "--cli",
          "--method",
          "tools/list",
          "--transport",
          "http",
        ],
        {
          env: {
            MCP_OAUTH_CALLBACK_URL: "http://127.0.0.1:8888/custom/oauth/callback",
          },
        },
      );

      expectCliSuccess(result);
    } finally {
      await server.stop();
    }
  });

  it("rejects an invalid OAuth callback URL before connecting", async () => {
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
        "--transport",
        "http",
        "--callback-url",
        "not-a-valid-url",
      ]);

      expectCliFailure(result);
      expectOutputContains(result, "Invalid OAuth callback URL");
    } finally {
      await server.stop();
    }
  });
});
