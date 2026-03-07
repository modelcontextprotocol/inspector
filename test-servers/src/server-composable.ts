#!/usr/bin/env node

/**
 * Config-driven composable MCP test server
 * Usage: server-composable --config <path> [--json|--yaml]
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ResourceDefinition } from "./composable-test-server.js";
import { createMcpServer } from "./test-server-fixtures.js";
import { loadConfig, type ConfigFormat } from "./load-config.js";
import { resolveConfig } from "./resolve-config.js";
import { createTestServerHttp } from "./test-server-http.js";

function parseArgs(): {
  configPath: string | null;
  format: ConfigFormat | null;
} {
  const args = process.argv.slice(2);
  let configPath: string | null = null;
  let format: ConfigFormat | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      configPath = args[++i] ?? null;
    } else if (args[i] === "--json") {
      format = "json";
    } else if (args[i] === "--yaml") {
      format = "yaml";
    }
  }

  return { configPath, format };
}

function addStdioResourceCallback(config: ReturnType<typeof resolveConfig>) {
  return {
    ...config,
    onRegisterResource: (resource: ResourceDefinition) => {
      if (
        resource.name === "test_cwd" ||
        resource.name === "test_env" ||
        resource.name === "test_argv"
      ) {
        return async () => {
          let text: string;
          if (resource.name === "test_cwd") {
            text = process.cwd();
          } else if (resource.name === "test_env") {
            text = JSON.stringify(process.env, null, 2);
          } else if (resource.name === "test_argv") {
            text = JSON.stringify(process.argv, null, 2);
          } else {
            text = (resource as { text?: string }).text ?? "";
          }
          return {
            contents: [
              {
                uri: resource.uri,
                mimeType: resource.mimeType || "text/plain",
                text,
              },
            ],
          };
        };
      }
      return undefined;
    },
  };
}

async function main(): Promise<void> {
  const { configPath, format } = parseArgs();

  if (!configPath) {
    console.error("Usage: server-composable --config <path> [--json | --yaml]");
    process.exit(1);
  }

  let config;
  try {
    config = loadConfig(configPath, format ? { format } : undefined);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  let serverConfig;
  try {
    serverConfig = resolveConfig(config);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const transportType = config.transport.type;

  if (transportType === "stdio") {
    const configWithCallback = addStdioResourceCallback(serverConfig);
    const mcpServer = createMcpServer(configWithCallback);
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    // Process stays alive; stdio keeps it open
  } else {
    // HTTP (streamable-http or sse)
    const httpServer = createTestServerHttp(serverConfig);
    const port = await httpServer.start();
    console.error(
      `Composable server listening at http://127.0.0.1:${port}${config.transport.type === "sse" ? "/sse" : "/mcp"}`,
    );

    const shutdown = async () => {
      await httpServer.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
