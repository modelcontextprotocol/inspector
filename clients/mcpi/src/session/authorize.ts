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
import { createCliOAuthNavigation } from "@inspector/cli/cli-oauth-navigation.js";
import { connectInspectorWithOAuth } from "@inspector/cli/cliOAuth.js";
import { CliExitCodeError, EXIT_CODES } from "@inspector/cli/error-handler.js";
import { isEmaClientNotConfiguredError } from "@inspector/core/auth/ema/clientConfigError.js";
import { mcpiEmaGuidance } from "./ema.js";

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
  // Disarmed until connectInspectorWithOAuth's own interactive-OAuth window
  // runs — mirrors the one-shot CLI's autoOpenControl (clients/cli/src/cli.ts):
  // SDK `auth()` during plain connect() must not print/open before that
  // window (or --stored-auth-only) gates it.
  const autoOpenControl = { armed: false };
  environment.oauth = {
    storage: new NodeOAuthStorage(),
    // mcpi always attempts interactive OAuth (see the isTTY override below) —
    // whoever is running it (human or agent) may not have a real TTY on
    // stdin/stderr. Reword the printed line so an agent knows it must relay
    // the link to a human rather than treating "Please navigate to" as
    // addressed to itself.
    navigation: createCliOAuthNavigation({
      autoOpenControl,
      disableAutoOpen: options?.storedAuthOnly,
      promptMessage: (hrefDisplay, tty) =>
        tty
          ? `Please navigate to: ${hrefDisplay}`
          : `The user needs to navigate to this link to authenticate: ${hrefDisplay}`,
    }),
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
      {
        storedAuthOnly: options?.storedAuthOnly,
        // mcpi runs as a front-end for whatever invoked it (human terminal or
        // agent subprocess) — always admit interactive OAuth rather than
        // refusing when stdin/stderr aren't a real TTY. The CI-hang concern
        // behind that gate (see clients/cli/README.md OAuth section) doesn't
        // apply here: an agent without a TTY is still expected to relay the
        // printed URL to an attended human, not run unattended. --stored-auth-only
        // (checked above assertInteractiveOAuthAllowed, so unaffected by this)
        // remains the way to opt out of interactive OAuth entirely.
        isTTY: true,
        autoOpenControl,
      },
    );
  } catch (err) {
    // An EMA server without active install-level IdP config: interactive
    // OAuth cannot fix this, so replace the core error (which points at the
    // web Client Settings dialog only) with mcpi-appropriate guidance.
    if (isEmaClientNotConfiguredError(err)) {
      throw new CliExitCodeError(
        EXIT_CODES.AUTH_REQUIRED,
        mcpiEmaGuidance(err.reason),
        { code: "auth_required" },
      );
    }
    throw err;
  } finally {
    try {
      await client.disconnect();
    } catch {
      // best-effort
    }
  }
}
