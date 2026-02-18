import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { getTestMcpServerCommand } from "./test-server-stdio.js";

/**
 * Sentinel value for tests that don't need a real server
 * (tests that expect failure before connecting)
 */
export const NO_SERVER_SENTINEL = "invalid-command-that-does-not-exist";

/**
 * Create a sample test config with test-stdio and test-http servers
 * Returns a temporary config file path that should be cleaned up with deleteConfigFile()
 * @param httpUrl - Optional full URL (including /mcp path) for test-http server.
 *                  If not provided, uses a placeholder URL. The test-http server exists
 *                  to test server selection logic and may not actually be used.
 */
export function createSampleTestConfig(httpUrl?: string): string {
  const { command, args } = getTestMcpServerCommand();
  return createTestConfig({
    mcpServers: {
      "test-stdio": {
        type: "stdio",
        command,
        args,
        env: {
          HELLO: "Hello MCP!",
        },
      },
      "test-http": {
        type: "streamable-http",
        url: httpUrl || "http://localhost:3001/mcp",
      },
    },
  });
}

/**
 * Create a temporary directory for test files
 * Uses crypto.randomUUID() to ensure uniqueness even when called in parallel
 */
function createTempDir(prefix: string = "mcp-inspector-test-"): string {
  const uniqueId = crypto.randomUUID();
  const tempDir = path.join(os.tmpdir(), `${prefix}${uniqueId}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Clean up temporary directory
 */
function cleanupTempDir(dir: string) {
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
 * Delete a config file and its containing directory
 */
export function deleteConfigFile(configPath: string): void {
  cleanupTempDir(path.dirname(configPath));
}
