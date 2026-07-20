import { MutableRedirectUrlProvider } from "@inspector/core/auth/index.js";
import { NodeOAuthStorage } from "@inspector/core/auth/node/index.js";
import {
  DEFAULT_RUNNER_OAUTH_CALLBACK_URL,
  formatRunnerOAuthRedirectUrl,
  parseRunnerOAuthCallbackUrl,
} from "@inspector/core/auth/node/runner-oauth-callback.js";
import {
  buildRunnerClientAuthOptions,
  isOAuthCapableServerConfig,
  loadRunnerClientConfig,
} from "@inspector/core/client/runner.js";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import { createTransportNode } from "@inspector/core/mcp/node/index.js";
import {
  eraToVersionNegotiation,
  type InspectorClientEnvironment,
  type InspectorServerSettings,
  type MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import { readInspectorVersion } from "@inspector/core/node/version.js";
import { createCliOAuthNavigation } from "../cli-oauth-navigation.js";
import { connectInspectorWithOAuth } from "../cliOAuth.js";

/**
 * Run interactive (or stored-auth-only) OAuth in the front-end process so tokens
 * land in the shared `oauth.json` store, then the daemon can reconnect.
 */
export async function authorizeInFrontend(
  serverConfig: MCPServerConfig,
  serverSettings: InspectorServerSettings | undefined,
  options?: { storedAuthOnly?: boolean },
): Promise<void> {
  if (!isOAuthCapableServerConfig(serverConfig)) {
    return;
  }

  const environment: InspectorClientEnvironment = {
    transport: createTransportNode,
  };
  const redirectUrlProvider = new MutableRedirectUrlProvider();
  const callbackUrlConfig = parseRunnerOAuthCallbackUrl(
    process.env.MCP_OAUTH_CALLBACK_URL ?? DEFAULT_RUNNER_OAUTH_CALLBACK_URL,
  );
  redirectUrlProvider.redirectUrl =
    formatRunnerOAuthRedirectUrl(callbackUrlConfig);
  environment.oauth = {
    storage: new NodeOAuthStorage(),
    navigation: createCliOAuthNavigation(),
    redirectUrlProvider,
  };

  const clientConfig = await loadRunnerClientConfig({});
  const clientAuthOptions = buildRunnerClientAuthOptions(
    clientConfig,
    serverSettings,
    {},
  );

  const client = new InspectorClient(serverConfig, {
    environment,
    clientIdentity: {
      name: "inspector-cli",
      version: readInspectorVersion(import.meta.url),
    },
    initialLoggingLevel: "debug",
    progress: false,
    sample: false,
    elicit: false,
    serverSettings,
    ...(serverSettings?.protocolEra && {
      versionNegotiation: eraToVersionNegotiation(serverSettings.protocolEra),
    }),
    ...clientAuthOptions,
  });

  try {
    await connectInspectorWithOAuth(
      client,
      serverConfig,
      redirectUrlProvider,
      callbackUrlConfig,
      serverSettings,
      { storedAuthOnly: options?.storedAuthOnly },
    );
  } finally {
    try {
      await client.disconnect();
    } catch {
      // best-effort
    }
  }
}
