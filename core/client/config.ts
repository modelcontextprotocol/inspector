/**
 * Load/save/validate install-level client config (client.json).
 */

import {
  getDefaultStorageDir,
  getStoreFilePath,
  parseStore,
  readStoreFile,
  serializeStore,
  writeStoreFile,
} from "../storage/store-io.js";
import { parseClientConfig } from "./config-parse.js";
import type { ClientConfig } from "./types.js";

export { parseClientConfig, serializeClientConfig } from "./config-parse.js";

/** Default path: ~/.mcp-inspector/storage/client.json */
export function getClientConfigFilePath(customPath?: string): string {
  return customPath ?? getStoreFilePath(getDefaultStorageDir(), "client");
}

/**
 * Read client.json from disk. Returns `{}` when the file is absent.
 */
export async function loadClientConfig(options?: {
  filePath?: string;
}): Promise<ClientConfig> {
  const filePath = getClientConfigFilePath(options?.filePath);
  const raw = await readStoreFile(filePath);
  if (raw === null) {
    return {};
  }
  return parseClientConfig(parseStore(raw));
}

/** Write client.json atomically (mode 0o600). */
export async function saveClientConfig(
  config: ClientConfig,
  options?: { filePath?: string },
): Promise<void> {
  const validated = parseClientConfig(config);
  const filePath = getClientConfigFilePath(options?.filePath);
  await writeStoreFile(filePath, serializeStore(validated));
}
