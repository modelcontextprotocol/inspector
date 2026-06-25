/**
 * Load/save/validate install-level client config (client.json).
 */

import type { SecretStore } from "../auth/node/secret-store.js";
import {
  getDefaultStorageDir,
  getStoreFilePath,
  parseStore,
  readStoreFile,
  serializeStore,
  writeStoreFile,
} from "../storage/store-io.js";
import { parseClientConfig } from "./config-parse.js";
import {
  readClientConfigStore,
  writeClientConfigStore,
} from "./node-persistence.js";
import type { ClientConfig } from "./types.js";

export { parseClientConfig, serializeClientConfig } from "./config-parse.js";

/** Default path: ~/.mcp-inspector/storage/client.json */
export function getClientConfigFilePath(customPath?: string): string {
  return customPath ?? getStoreFilePath(getDefaultStorageDir(), "client");
}

/**
 * Read client.json from disk. Returns `{}` when the file is absent.
 * When `secretStore` is provided, IdP clientSecret is read from the keychain.
 */
export async function loadClientConfig(options?: {
  filePath?: string;
  secretStore?: SecretStore;
}): Promise<ClientConfig> {
  const filePath = getClientConfigFilePath(options?.filePath);
  if (options?.secretStore) {
    return readClientConfigStore(filePath, options.secretStore);
  }

  const raw = await readStoreFile(filePath);
  if (raw === null) {
    return {};
  }
  return parseClientConfig(parseStore(raw));
}

/** Write client.json atomically (mode 0o600). */
export async function saveClientConfig(
  config: ClientConfig,
  options?: { filePath?: string; secretStore?: SecretStore },
): Promise<void> {
  const filePath = getClientConfigFilePath(options?.filePath);
  if (options?.secretStore) {
    await writeClientConfigStore(filePath, config, options.secretStore);
    return;
  }

  const validated = parseClientConfig(config);
  await writeStoreFile(filePath, serializeStore(validated));
}

export {
  deleteClientConfigStore,
  readClientConfigStore,
  writeClientConfigStore,
} from "./node-persistence.js";
