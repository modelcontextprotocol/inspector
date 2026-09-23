import {
  clearEmaIdpSession,
  getEmaIdpLoginState,
  normalizeIdpIssuer,
  type EmaIdpLoginState,
} from "@inspector/core/auth/ema/index.js";
import type { EmaClientNotConfiguredReason } from "@inspector/core/auth/ema/clientConfigError.js";
import {
  completeIdpOidcAuthorization,
  startIdpOidcAuthorization,
} from "@inspector/core/auth/ema/idpOidc.js";
import { MutableRedirectUrlProvider } from "@inspector/core/auth/index.js";
import {
  NodeOAuthStorage,
  runRunnerInteractiveOAuth,
} from "@inspector/core/auth/node/index.js";
import { resetNodeOAuthStorageCache } from "@inspector/core/auth/node/storage-node.js";
import {
  DEFAULT_RUNNER_OAUTH_CALLBACK_URL,
  formatRunnerOAuthRedirectUrl,
  parseRunnerOAuthCallbackUrl,
} from "@inspector/core/auth/node/runner-oauth-callback.js";
import { getClientConfigFilePath } from "@inspector/core/client/index.js";
import { loadRunnerClientConfig } from "@inspector/core/client/runner.js";
import type { EnterpriseManagedAuthIdpConfig } from "@inspector/core/client/types.js";
import { createCliOAuthNavigation } from "@inspector/cli/cli-oauth-navigation.js";
import { CliExitCodeError, EXIT_CODES } from "@inspector/cli/error-handler.js";

/** Where install-level EMA IdP config lives (honours MCP_CLIENT_CONFIG_PATH). */
function clientConfigPath(): string {
  return getClientConfigFilePath(
    process.env.MCP_CLIENT_CONFIG_PATH?.trim() || undefined,
  );
}

/**
 * mcp-conn-flavoured guidance for a missing/disabled EMA client configuration.
 * The core `EmaClientNotConfiguredError` message points at the web Client
 * Settings dialog; mcpdo users may equally well edit `client.json` directly,
 * so name both, with the resolved path.
 */
export function mcpdoEmaGuidance(reason: EmaClientNotConfiguredReason): string {
  const path = clientConfigPath();
  if (reason === "disabled") {
    return (
      "Enterprise-managed auth (EMA) is configured but disabled. Enable it in " +
      "the web Inspector's Client Settings, or set " +
      `enterpriseManagedAuth.enabled to true in ${path}.`
    );
  }
  return (
    "Enterprise-managed auth (EMA) is not configured. Configure the " +
    "enterprise IdP (issuer, client ID, client secret) in the web Inspector's " +
    `Client Settings, or add an enterpriseManagedAuth block to ${path}.`
  );
}

export type EmaStatus = {
  /** Resolved client.json path the config was read from. */
  clientConfigPath: string;
  /** An IdP block exists in client.json (even if disabled). */
  configured: boolean;
  /** Configured and not explicitly disabled. */
  enabled: boolean;
  issuer?: string;
  clientId?: string;
  /** IdP session state; "unconfigured" when no IdP block exists. */
  loginState: EmaIdpLoginState | "unconfigured";
};

/** Read install-level EMA config; the raw idp block, even when disabled. */
async function loadEmaIdpConfig(): Promise<{
  idp: EnterpriseManagedAuthIdpConfig | undefined;
  enabled: boolean;
}> {
  const clientConfig = await loadRunnerClientConfig({});
  const ema = clientConfig.enterpriseManagedAuth;
  return {
    idp: ema?.idp,
    enabled: Boolean(ema?.idp) && ema?.enabled !== false,
  };
}

function requireIdp(
  idp: EnterpriseManagedAuthIdpConfig | undefined,
  enabled: boolean,
  options?: { allowDisabled?: boolean },
): EnterpriseManagedAuthIdpConfig {
  if (!idp) {
    throw new CliExitCodeError(
      EXIT_CODES.USAGE,
      mcpdoEmaGuidance("not_configured"),
      {
        code: "usage",
      },
    );
  }
  if (!enabled && !options?.allowDisabled) {
    throw new CliExitCodeError(EXIT_CODES.USAGE, mcpdoEmaGuidance("disabled"), {
      code: "usage",
    });
  }
  return idp;
}

/** EMA configuration + IdP session state for `auth/ema-status`. */
export async function getEmaStatus(): Promise<EmaStatus> {
  const { idp, enabled } = await loadEmaIdpConfig();
  if (!idp) {
    return {
      clientConfigPath: clientConfigPath(),
      configured: false,
      enabled: false,
      loginState: "unconfigured",
    };
  }
  const storage = new NodeOAuthStorage();
  const loginState = await getEmaIdpLoginState(storage, idp.issuer);
  return {
    clientConfigPath: clientConfigPath(),
    configured: true,
    enabled,
    issuer: normalizeIdpIssuer(idp.issuer),
    clientId: idp.clientId,
    loginState,
  };
}

export type EmaLogoutResult = { issuer: string };

/**
 * Sign out of the enterprise IdP: clears the cached IdP OIDC connection and all
 * EMA-minted resource-server tokens. Works even when EMA is disabled (state
 * cleanup should never be blocked by the enabled flag).
 */
export async function emaLogout(): Promise<EmaLogoutResult> {
  const { idp, enabled } = await loadEmaIdpConfig();
  const active = requireIdp(idp, enabled, { allowDisabled: true });
  const storage = new NodeOAuthStorage();
  await clearEmaIdpSession(storage, active.issuer);
  resetNodeOAuthStorageCache();
  return { issuer: normalizeIdpIssuer(active.issuer) };
}

export type EmaLoginResult = {
  issuer: string;
  loginState: EmaIdpLoginState;
  alreadyLoggedIn: boolean;
};

/**
 * Sign in to the enterprise IdP (EMA leg 1 only — no server required): print
 * the IdP authorization URL, wait on the loopback callback, and exchange the
 * code for an IdP session. Subsequent connects to EMA servers mint resource
 * tokens silently from this connection.
 *
 * Non-TTY (agent-attended) callers get wording that directs the agent to
 * relay the link to the human user, mirroring `authorizeInFrontend`. SIGINT /
 * SIGTERM and the callback timeout are handled by
 * {@link runRunnerInteractiveOAuth}.
 */
export async function emaLogin(options?: {
  /** Clear any existing IdP session (and EMA server tokens) first. */
  relogin?: boolean;
}): Promise<EmaLoginResult> {
  const { idp, enabled } = await loadEmaIdpConfig();
  const active = requireIdp(idp, enabled);
  const issuer = normalizeIdpIssuer(active.issuer);
  const storage = new NodeOAuthStorage();

  if (options?.relogin) {
    await clearEmaIdpSession(storage, active.issuer);
  } else if (
    (await getEmaIdpLoginState(storage, active.issuer)) === "logged_in"
  ) {
    return { issuer, loginState: "logged_in", alreadyLoggedIn: true };
  }

  const callbackUrlConfig = parseRunnerOAuthCallbackUrl(
    process.env.MCP_OAUTH_CALLBACK_URL ?? DEFAULT_RUNNER_OAUTH_CALLBACK_URL,
  );
  const redirectUrlProvider = new MutableRedirectUrlProvider();
  redirectUrlProvider.redirectUrl =
    formatRunnerOAuthRedirectUrl(callbackUrlConfig);
  // Armed from the start: unlike connect-time OAuth there is no SDK-internal
  // auth() phase to guard against — this flow owns its one authorize URL.
  const navigation = createCliOAuthNavigation({
    autoOpenControl: { armed: true },
    promptMessage: (hrefDisplay, tty) =>
      tty
        ? `Sign in to your enterprise IdP: ${hrefDisplay}`
        : "The user needs to sign in to the enterprise identity provider " +
          `(IdP) at this link: ${hrefDisplay}`,
  });

  // Adapter over the server-bound runner-interactive-OAuth surface: EMA leg 1
  // is server-less, so authenticate/completeOAuthFlow map straight onto the
  // IdP OIDC start/complete helpers. This reuses the loopback callback
  // server, 15-minute timeout, and SIGINT/SIGTERM cancellation.
  await runRunnerInteractiveOAuth({
    client: {
      authenticate: async () => {
        const { authorizationUrl } = await startIdpOidcAuthorization({
          idp: active,
          redirectUrl: redirectUrlProvider.redirectUrl,
          storage,
        });
        navigation.navigateToAuthorization(authorizationUrl);
        return authorizationUrl;
      },
      /* v8 ignore next 2 -- only reached when options.authorizationUrl is set, which this flow never does */
      beginInteractiveAuthorization: async () => {},
      completeOAuthFlow: async (authorizationCode, iss) => {
        await completeIdpOidcAuthorization({
          idp: active,
          authorizationCode,
          iss,
          redirectUrl: redirectUrlProvider.redirectUrl,
          storage,
        });
      },
      /* v8 ignore next 2 -- only reached when options.authChallenge is set, which this flow never does */
      checkAuthChallengeSatisfied: async () => false,
    },
    redirectUrlProvider,
    callbackListen: callbackUrlConfig,
    // mcpdo is a plain CLI (no Ink); own Ctrl-C during the IdP wait.
    handleSignals: true,
  });
  resetNodeOAuthStorageCache();

  return {
    issuer,
    loginState: await getEmaIdpLoginState(storage, active.issuer),
    alreadyLoggedIn: false,
  };
}
