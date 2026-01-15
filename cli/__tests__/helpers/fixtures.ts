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
