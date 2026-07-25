import type { SecretStore } from "../../auth/node/secret-store.js";
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
  const out: MCPConfig = { mcpServers: {} };
  await Promise.all(
    Object.entries(config.mcpServers).map(async ([id, stored]) => {
      const fields = expectedSecretFields(stored);
      const secrets: Record<string, string> = {};
      await Promise.all(
        fields.map(async (field) => {
          const value = await secretStore.get(id, field);
          if (value !== null) {
            secrets[field] = value;
          }
        }),
      );
      out.mcpServers[id] = mergeSecretsIntoStored(stored, secrets);
    }),
  );
  return out;
}
