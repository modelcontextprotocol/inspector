/**
 * Install-level client config loading and InspectorClient auth option wiring
 * for Node runners (TUI, CLI).
 */

import { KeyringSecretStore } from "../auth/node/secret-store.js";
import type { InspectorClientOptions, InspectorServerSettings } from "../mcp/types.js";
import { loadClientConfig } from "./config.js";
import type { ClientConfig } from "./types.js";
import {
  getActiveCimdClientMetadataUrl,
  getActiveEnterpriseManagedAuthIdp,
} from "./types.js";

export interface LoadRunnerClientConfigOptions {
  /** Explicit path from `--client-config` (or MCP_CLIENT_CONFIG_PATH when unset). */
  clientConfigPath?: string;
}

/** Load install-level client.json with keychain-backed IdP secrets. */
export async function loadRunnerClientConfig(
  options?: LoadRunnerClientConfigOptions,
): Promise<ClientConfig> {
  const customPath =
    options?.clientConfigPath?.trim() ||
    process.env.MCP_CLIENT_CONFIG_PATH?.trim() ||
    undefined;
  const secretStore = new KeyringSecretStore();
  return loadClientConfig({ filePath: customPath, secretStore });
}

export interface RunnerClientConfigOverrides {
  clientId?: string;
  clientSecret?: string;
  clientMetadataUrl?: string;
}

/** HTTP transports (SSE, streamable-http) can use OAuth. */
export function isOAuthCapableServerConfig(
  config: { type?: string } | null | undefined,
): boolean {
  if (!config) return false;
  return config.type === "sse" || config.type === "streamable-http";
}

/**
 * Derive OAuth / EMA / CIMD InspectorClient options from install client.json,
 * per-server settings, and CLI flag overrides (flags win over client.json).
 */
export function buildRunnerClientAuthOptions(
  clientConfig: ClientConfig,
  savedSettings?: InspectorServerSettings,
  cliOverrides?: RunnerClientConfigOverrides,
): Pick<
  InspectorClientOptions,
  "oauth" | "enterpriseManagedAuth" | "installEnterpriseManagedAuth" | "directAuthRecovery"
> {
  const activeIdp = getActiveEnterpriseManagedAuthIdp(clientConfig);
  const activeCimdUrl = getActiveCimdClientMetadataUrl(clientConfig);

  const oauthFromServer =
    savedSettings &&
    (savedSettings.oauthClientId ||
      savedSettings.oauthClientSecret ||
      savedSettings.oauthScopes ||
      savedSettings.enterpriseManaged)
      ? {
          ...(savedSettings.oauthClientId && {
            clientId: savedSettings.oauthClientId,
          }),
          ...(savedSettings.oauthClientSecret && {
            clientSecret: savedSettings.oauthClientSecret,
          }),
          ...(savedSettings.oauthScopes && {
            scope: savedSettings.oauthScopes,
          }),
          ...(savedSettings.enterpriseManaged && {
            enterpriseManaged: true,
          }),
        }
      : undefined;

  const clientMetadataUrl =
    cliOverrides?.clientMetadataUrl?.trim() || activeCimdUrl;

  const oauthFromCli =
    cliOverrides?.clientId ||
    cliOverrides?.clientSecret ||
    clientMetadataUrl
      ? {
          ...(cliOverrides?.clientId && { clientId: cliOverrides.clientId }),
          ...(cliOverrides?.clientSecret && {
            clientSecret: cliOverrides.clientSecret,
          }),
          ...(clientMetadataUrl && { clientMetadataUrl }),
        }
      : undefined;

  const oauth =
    oauthFromServer || oauthFromCli
      ? {
          ...(oauthFromServer ?? {}),
          ...(oauthFromCli ?? {}),
        }
      : undefined;

  return {
    ...(oauth && { oauth }),
    ...(activeIdp && {
      enterpriseManagedAuth: { idp: activeIdp },
    }),
    ...(clientConfig.enterpriseManagedAuth && {
      installEnterpriseManagedAuth: clientConfig.enterpriseManagedAuth,
    }),
    ...(oauth && { directAuthRecovery: true }),
  };
}
