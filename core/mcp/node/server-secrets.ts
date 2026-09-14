import {
  secretStoreGetMany,
  type SecretStore,
} from "../../auth/node/secret-store.js";
import { expectedSecretFields, mergeSecretsIntoStored } from "../serverList.js";
import type { MCPConfig } from "../types.js";

/**
 * Merge per-server secrets from the OS keychain into an on-disk MCP catalog
 * shape. Mirrors the web `/api/servers` GET rehydration path so TUI/CLI see
 * the same effective OAuth client secrets and stdio env values as the browser.
 */
export async function rehydrateMcpConfigFromKeychain(
  config: MCPConfig,
  secretStore: SecretStore,
): Promise<MCPConfig> {
  const entries = Object.entries(config.mcpServers);
  // One pass for the *whole catalog*, not one per server and not one per
  // field. For the keychain this is the same parallel round-trips as before;
  // for the file store it collapses the entire rehydration into a single
  // read-and-decrypt (see `secretStoreGetMany`). Batching per server instead
  // left a 20-server catalog paying 20 serialized scrypt derivations.
  const secrets = await secretStoreGetMany(
    secretStore,
    entries.map(([serverId, stored]) => ({
      serverId,
      fields: expectedSecretFields(stored),
    })),
  );
  const out: MCPConfig = { mcpServers: {} };
  for (const [id, stored] of entries) {
    out.mcpServers[id] = mergeSecretsIntoStored(stored, secrets[id] ?? {});
  }
  return out;
}
