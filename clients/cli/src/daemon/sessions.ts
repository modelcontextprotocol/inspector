import { InspectorClient } from "@inspector/core/mcp/index.js";
import type { InspectorClientEnvironment } from "@inspector/core/mcp/types.js";
import {
  eraToVersionNegotiation,
  type InspectorServerSettings,
  type MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import { createTransportNode } from "@inspector/core/mcp/node/index.js";
import {
  ConsoleNavigation,
  MutableRedirectUrlProvider,
} from "@inspector/core/auth/index.js";
import { NodeOAuthStorage } from "@inspector/core/auth/node/index.js";
import { resetNodeOAuthStorageCache } from "@inspector/core/auth/node/storage-node.js";
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
import { readInspectorVersion } from "@inspector/core/node/version.js";
import {
  AuthRecoveryRequiredError,
  isUnauthorizedError,
} from "@inspector/core/auth/index.js";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import type { SessionInfo } from "./protocol.js";

const SESSION_CLIENT_NAME = "inspector-cli";

/** Default idle timeout after the last session disconnects (~60s). */
export const DEFAULT_IDLE_MS = 60_000;

type LiveSession = {
  name: string;
  serverIdentity: string;
  connectedAt: number;
  lastAccessedAt: number;
  client: InspectorClient;
};

/**
 * In-memory registry of live MCP sessions owned by the daemon.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, LiveSession>();
  private mruName: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Absolute deadline for idle shutdown while the timer is armed. */
  private idleDeadline: number | null = null;
  private onIdle: (() => void) | null = null;
  private readonly idleMs: number;

  constructor(idleMs: number = DEFAULT_IDLE_MS) {
    this.idleMs = idleMs;
  }

  /** Register a callback invoked when the idle timer fires with no sessions. */
  setIdleHandler(handler: (() => void) | null): void {
    this.onIdle = handler;
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()]
      .map((s) => ({
        name: s.name,
        serverIdentity: s.serverIdentity,
        connectedAt: s.connectedAt,
        lastAccessedAt: s.lastAccessedAt,
        isMru: s.name === this.mruName,
      }))
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  getMruName(): string | null {
    return this.mruName;
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Resolve a session by explicit name or MRU. Throws {@link CliExitCodeError}
   * when missing / ambiguous under CI rules.
   */
  resolve(
    name: string | undefined,
    requireExplicit: boolean | undefined,
  ): LiveSession {
    if (!name) {
      if (requireExplicit) {
        throw new CliExitCodeError(
          EXIT_CODES.USAGE,
          "Explicit --session / @name is required in non-interactive mode.",
          { code: "session_required" },
        );
      }
      if (!this.mruName) {
        throw new CliExitCodeError(
          EXIT_CODES.USAGE,
          "No open sessions. Connect first (e.g. mcp servers/list, mcp connect <entry>).",
          { code: "no_session" },
        );
      }
      name = this.mruName;
    }
    const session = this.sessions.get(name);
    if (!session) {
      throw new CliExitCodeError(
        EXIT_CODES.USAGE,
        `Session '${name}' not found. Use mcp sessions/list.`,
        { code: "session_not_found" },
      );
    }
    return session;
  }

  touch(name: string): void {
    const session = this.sessions.get(name);
    if (!session) return;
    session.lastAccessedAt = Date.now();
    this.mruName = name;
    this.clearIdleTimer();
  }

  /**
   * Resolve a session for an RPC/stream, touch MRU, and return its client.
   */
  clientFor(
    name: string | undefined,
    requireExplicit: boolean | undefined,
  ): InspectorClient {
    const session = this.resolve(name, requireExplicit);
    this.touch(session.name);
    return session.client;
  }

  use(name: string): SessionInfo {
    const session = this.resolve(name, true);
    this.touch(session.name);
    return {
      name: session.name,
      serverIdentity: session.serverIdentity,
      connectedAt: session.connectedAt,
      lastAccessedAt: session.lastAccessedAt,
      isMru: true,
    };
  }

  async connect(params: {
    name: string;
    serverConfig: MCPServerConfig;
    serverSettings?: InspectorServerSettings;
    serverIdentity: string;
  }): Promise<SessionInfo> {
    this.clearIdleTimer();

    if (this.sessions.has(params.name)) {
      // Reconnect: tear down the previous client first.
      await this.disconnect(params.name, false);
    }

    // Front-end authorize / auth/clear write oauth.json in another process.
    // Drop the daemon's cached store so this connect re-reads disk.
    resetNodeOAuthStorageCache();

    const client = await createSessionClient(
      params.serverConfig,
      params.serverSettings,
    );

    try {
      await client.connect();
    } catch (error) {
      await safeDisconnect(client);
      if (isSessionAuthRequiredError(error)) {
        throw new CliExitCodeError(
          EXIT_CODES.AUTH_REQUIRED,
          error instanceof Error ? error.message : String(error),
          { code: "auth_required" },
        );
      }
      throw error;
    }

    const now = Date.now();
    this.sessions.set(params.name, {
      name: params.name,
      serverIdentity: params.serverIdentity,
      connectedAt: now,
      lastAccessedAt: now,
      client,
    });
    this.mruName = params.name;

    return {
      name: params.name,
      serverIdentity: params.serverIdentity,
      connectedAt: now,
      lastAccessedAt: now,
      isMru: true,
    };
  }

  async disconnect(
    name: string | undefined,
    requireExplicit: boolean | undefined,
  ): Promise<{ name: string }> {
    const session = this.resolve(name, requireExplicit);
    const sessionName = session.name;
    this.sessions.delete(sessionName);
    if (this.mruName === sessionName) {
      // Promote the next most-recently-accessed session, if any.
      const remaining = [...this.sessions.values()].sort(
        (a, b) => b.lastAccessedAt - a.lastAccessedAt,
      );
      this.mruName = remaining[0]?.name ?? null;
    }
    await safeDisconnect(session.client);
    if (this.sessions.size === 0) {
      this.armIdleTimer();
    }
    return { name: sessionName };
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.sessions.keys()];
    for (const name of names) {
      await this.disconnect(name, false);
    }
    this.clearIdleTimer();
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    if (this.idleMs <= 0 || !this.onIdle) return;
    this.idleDeadline = Date.now() + this.idleMs;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.idleDeadline = null;
      if (this.sessions.size === 0) {
        this.onIdle?.();
      }
    }, this.idleMs);
    // Don't keep the process alive solely for the idle timer when nothing else
    // is pending — the socket server keeps the event loop alive.
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.idleDeadline = null;
  }

  /** Remaining ms until idle shutdown, or null if not armed. */
  idleRemainingMs(): number | null {
    if (this.idleDeadline === null) return null;
    return Math.max(0, this.idleDeadline - Date.now());
  }
}

/**
 * Connect failures that should trigger front-end interactive OAuth (then retry),
 * not a hard ErrorEnvelope. Includes SDK token-exchange mistakes that happen when
 * stored creds need a full re-auth.
 */
export function isSessionAuthRequiredError(error: unknown): boolean {
  if (
    error instanceof AuthRecoveryRequiredError ||
    isUnauthorizedError(error)
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    /prepareTokenRequest\(\) or authorizationCode is required/i.test(message) ||
    /redirectUrl is required for authorization_code/i.test(message) ||
    /No code verifier saved for session/i.test(message)
  );
}

async function createSessionClient(
  serverConfig: MCPServerConfig,
  serverSettings: InspectorServerSettings | undefined,
): Promise<InspectorClient> {
  const environment: InspectorClientEnvironment = {
    transport: createTransportNode,
  };
  const redirectUrlProvider = new MutableRedirectUrlProvider();
  if (isOAuthCapableServerConfig(serverConfig)) {
    // Must be non-empty: SDK treats a falsy redirectUrl as "non-interactive" and
    // calls fetchToken() without an authorization code (breaking stored-token /
    // refresh reconnect). Interactive login still runs in the front-end on
    // auth_required; this value only keeps the daemon's silent path correct.
    const callbackUrlConfig = parseRunnerOAuthCallbackUrl(
      process.env.MCP_OAUTH_CALLBACK_URL ?? DEFAULT_RUNNER_OAUTH_CALLBACK_URL,
    );
    redirectUrlProvider.redirectUrl =
      formatRunnerOAuthRedirectUrl(callbackUrlConfig);
    environment.oauth = {
      storage: new NodeOAuthStorage(),
      navigation: new ConsoleNavigation(),
      redirectUrlProvider,
    };
  }

  const clientConfig = await loadRunnerClientConfig({});
  const clientAuthOptions = buildRunnerClientAuthOptions(
    clientConfig,
    serverSettings,
    {},
  );

  return new InspectorClient(serverConfig, {
    environment,
    clientIdentity: {
      name: SESSION_CLIENT_NAME,
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
}

async function safeDisconnect(client: InspectorClient): Promise<void> {
  try {
    await client.disconnect();
  } catch {
    // Best-effort teardown.
  }
}
