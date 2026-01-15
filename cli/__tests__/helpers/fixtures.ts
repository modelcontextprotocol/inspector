import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../../");

export const TEST_SERVER = "@modelcontextprotocol/server-everything@2026.1.14";

/**
 * Get the sample config file path
 */
export function getSampleConfigPath(): string {
  return path.join(PROJECT_ROOT, "sample-config.json");
}

/**
 * Create a temporary directory for test files
 * Uses crypto.randomUUID() to ensure uniqueness even when called in parallel
 */
export function createTempDir(prefix: string = "mcp-inspector-test-"): string {
  const uniqueId = crypto.randomUUID();
  const tempDir = path.join(os.tmpdir(), `${prefix}${uniqueId}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Clean up temporary directory
 */
export function cleanupTempDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup errors
  }
}

/**
 * Create a test config file
 */
export function createTestConfig(config: {
  mcpServers: Record<string, any>;
}): string {
  const tempDir = createTempDir("mcp-inspector-config-");
  const configPath = path.join(tempDir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

/**
 * Create an invalid config file (malformed JSON)
 */
export function createInvalidConfig(): string {
  const tempDir = createTempDir("mcp-inspector-config-");
  const configPath = path.join(tempDir, "invalid-config.json");
  fs.writeFileSync(configPath, '{\n  "mcpServers": {\n    "invalid": {');
  return configPath;
}

/**
 * Get the directory containing a config file (for cleanup)
 */
export function getConfigDir(configPath: string): string {
  return path.dirname(configPath);
}

/**
 * Create a stdio config file
 */
export function createStdioConfig(): string {
  return createTestConfig({
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
}

/**
 * Create an SSE config file
 */
export function createSseConfig(): string {
  return createTestConfig({
    mcpServers: {
      "test-sse": {
        type: "sse",
        url: "http://localhost:3000/sse",
        note: "Test SSE server",
      },
    },
  });
}

/**
 * Create an HTTP config file
 */
export function createHttpConfig(): string {
  return createTestConfig({
    mcpServers: {
      "test-http": {
        type: "streamable-http",
        url: "http://localhost:3001/mcp",
        note: "Test HTTP server",
      },
    },
  });
}

/**
 * Create a legacy config file (without type field)
 */
export function createLegacyConfig(): string {
  return createTestConfig({
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
}

/**
 * Create a single-server config (for auto-selection)
 */
export function createSingleServerConfig(): string {
  return createTestConfig({
    mcpServers: {
      "only-server": {
        command: "npx",
        args: [TEST_SERVER],
      },
    },
  });
}

/**
 * Create a multi-server config with a "default-server" key (but still requires explicit selection)
 */
export function createDefaultServerConfig(): string {
  return createTestConfig({
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
}

/**
 * Create a multi-server config (no default)
 */
export function createMultiServerConfig(): string {
  return createTestConfig({
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
}
