import { InspectorClient } from "@inspector/core/mcp/index.js";
import type { InspectorClientEnvironment } from "@inspector/core/mcp/types.js";
import {
  DEFAULT_ELICIT_CAPABILITY,
  eraToVersionNegotiation,
  type ElicitCapabilityMode,
  type InspectorClientOptions,
  type InspectorServerSettings,
  type MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import { createTransportNode } from "@inspector/core/mcp/node/index.js";
import {
  buildOAuthConnectionState,
  ConsoleNavigation,
  hasPersistedOAuthServerState,
  isServerOAuthConfigured,
  MutableRedirectUrlProvider,
  protocolFromOAuthConfig,
} from "@inspector/core/auth/index.js";
import type { OAuthConnectionState } from "@inspector/core/auth/types.js";
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
import { isEmaClientNotConfiguredError } from "@inspector/core/auth/ema/clientConfigError.js";
import { CliExitCodeError, EXIT_CODES } from "@inspector/cli/error-handler.js";
import type { ConnectionAuthInfo, ConnectionInfo } from "./protocol.js";

const CONNECTION_CLIENT_NAME = "inspector-cli";

/** Default idle timeout after the last connection disconnects (~60s). */
export const DEFAULT_IDLE_MS = 60_000;

type LiveConnection = {
  name: string;
  serverIdentity: string;
  connectedAt: number;
  lastAccessedAt: number;
  client: InspectorClient;
  /** Retained for `connections/show`'s live auth recompute. */
  serverConfig: MCPServerConfig;
  serverSettings?: InspectorServerSettings;
  /** Connect-time snapshot (see {@link ConnectionInfo.auth}). */
  auth?: ConnectionAuthInfo;
};

/**
 * In-memory registry of live MCP connections owned by the daemon.
 */
export class ConnectionRegistry {
  private readonly connections = new Map<string, LiveConnection>();
  private mruName: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Absolute deadline for idle shutdown while the timer is armed. */
  private idleDeadline: number | null = null;
  private onIdle: (() => void) | null = null;
  private readonly idleMs: number;

  constructor(idleMs: number = DEFAULT_IDLE_MS) {
    this.idleMs = idleMs;
  }

  /** Register a callback invoked when the idle timer fires with no connections. */
  setIdleHandler(handler: (() => void) | null): void {
    this.onIdle = handler;
  }

  /**
   * Per-name serialization for connect/disconnect. Both hold `connections`
   * state across awaits; two simultaneous connects for the same
   * previously-unused name would otherwise both pass the reconnect check and
   * race through `connections.set`, leaving the loser's live client
   * untracked and undisconnectable.
   */
  private readonly nameLocks = new Map<string, Promise<void>>();

  /**
   * Set by {@link disconnectAll} (daemon shutdown). A connect that was
   * in-flight when the shutdown snapshot was taken — e.g. one that outlived
   * the bounded quiesce grace — must not register a live client afterwards:
   * nothing would ever disconnect it once the daemon exits.
   */
  private closed = false;

  private async withNameLock<T>(
    name: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.nameLocks.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    this.nameLocks.set(name, current);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.nameLocks.get(name) === current) this.nameLocks.delete(name);
    }
  }

  /**
   * Connects currently in flight (past {@link connectLocked} entry, not yet
   * registered or failed). The idle timer must not fire while one is
   * pending: a *different* name's failed connect (or a disconnect) would
   * otherwise re-arm the timer and stop the daemon under a valid connect
   * still awaiting `client.connect()`.
   */
  private pendingConnects = 0;

  /**
   * Arm the idle shutdown timer when there are no connections and no
   * connects in flight. Called at daemon start so a spawn that never
   * connects still self-reaps, and after a failed connect/disconnect that
   * left the registry empty.
   */
  armIdleTimerIfEmpty(): void {
    if (this.closed) return;
    if (this.connections.size === 0 && this.pendingConnects === 0) {
      this.armIdleTimer();
    }
  }

  list(): ConnectionInfo[] {
    return [...this.connections.values()]
      .map((s) => ({
        name: s.name,
        serverIdentity: s.serverIdentity,
        connectedAt: s.connectedAt,
        lastAccessedAt: s.lastAccessedAt,
        isMru: s.name === this.mruName,
        protocolEra: s.client.getProtocolEra(),
        ...(s.auth && { auth: s.auth }),
      }))
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  getMruName(): string | null {
    return this.mruName;
  }

  connectionCount(): number {
    return this.connections.size;
  }

  /**
   * Resolve a connection by explicit name or MRU. Throws {@link CliExitCodeError}
   * when missing / ambiguous under CI rules.
   */
  resolve(
    name: string | undefined,
    requireExplicit: boolean | undefined,
  ): LiveConnection {
    if (!name) {
      if (requireExplicit) {
        throw new CliExitCodeError(
          EXIT_CODES.USAGE,
          "Explicit --connection / @name is required in non-interactive mode.",
          { code: "connection_required" },
        );
      }
      if (!this.mruName) {
        throw new CliExitCodeError(
          EXIT_CODES.USAGE,
          "No open connections. Connect first (e.g. mcpdo servers/list, mcpdo connect <entry>).",
          { code: "no_connection" },
        );
      }
      name = this.mruName;
    }
    const connection = this.connections.get(name);
    if (!connection) {
      throw new CliExitCodeError(
        EXIT_CODES.USAGE,
        `Connection '${name}' not found. Use mcpdo connections/list.`,
        { code: "connection_not_found" },
      );
    }
    return connection;
  }

  touch(name: string): void {
    const connection = this.connections.get(name);
    if (!connection) return;
    connection.lastAccessedAt = Date.now();
    this.mruName = name;
    this.clearIdleTimer();
  }

  /**
   * Resolve a connection for an RPC/stream/show, touch MRU, and return the
   * live connection (name/serverIdentity/timestamps plus the client).
   */
  connectionFor(
    name: string | undefined,
    requireExplicit: boolean | undefined,
  ): LiveConnection {
    const connection = this.resolve(name, requireExplicit);
    this.touch(connection.name);
    return connection;
  }

  /**
   * Resolve a connection for an RPC/stream, touch MRU, and return its client.
   */
  clientFor(
    name: string | undefined,
    requireExplicit: boolean | undefined,
  ): InspectorClient {
    return this.connectionFor(name, requireExplicit).client;
  }

  use(name: string): ConnectionInfo {
    const connection = this.resolve(name, true);
    this.touch(connection.name);
    return {
      name: connection.name,
      serverIdentity: connection.serverIdentity,
      connectedAt: connection.connectedAt,
      lastAccessedAt: connection.lastAccessedAt,
      isMru: true,
      protocolEra: connection.client.getProtocolEra(),
      ...(connection.auth && { auth: connection.auth }),
    };
  }

  async connect(
    params: {
      name: string;
      serverConfig: MCPServerConfig;
      serverSettings?: InspectorServerSettings;
      serverIdentity: string;
    },
    signal?: AbortSignal,
  ): Promise<ConnectionInfo> {
    return this.withNameLock(params.name, () =>
      this.connectLocked(params, signal),
    );
  }

  private async connectLocked(
    params: {
      name: string;
      serverConfig: MCPServerConfig;
      serverSettings?: InspectorServerSettings;
      serverIdentity: string;
    },
    signal?: AbortSignal,
  ): Promise<ConnectionInfo> {
    this.assertOpen();
    this.clearIdleTimer();
    this.pendingConnects++;

    try {
      // Caller may already be gone (e.g. Ctrl-C while queued on the name
      // lock); don't start dialing on behalf of nobody.
      if (signal?.aborted) throw connectCancelledError();

      if (this.connections.has(params.name)) {
        // Reconnect: tear down the previous client first.
        await this.disconnectLocked(params.name);
      }

      // Front-end authorize / auth/clear write oauth.json in another process.
      // Drop the daemon's cached store so this connect re-reads disk.
      resetNodeOAuthStorageCache();

      const client = await createConnectionClient(
        params.serverConfig,
        params.serverSettings,
      );

      try {
        // Race the connect against caller hang-up: when the requesting
        // socket closes mid-dial (Ctrl-C, frontend crash) the daemon must
        // not keep the attempt alive — with `--connect-timeout 0` it would
        // otherwise pin `pendingConnects` (blocking idle shutdown) or
        // register a connection the user cancelled. On abort the shared
        // catch below tears the client down, which also cancels the
        // still-in-flight connect.
        await withAbort(() => client.connect(), signal, connectCancelledError);
      } catch (error) {
        await safeDisconnect(client);
        if (isConnectionAuthRequiredError(error)) {
          throw new CliExitCodeError(
            EXIT_CODES.AUTH_REQUIRED,
            error instanceof Error ? error.message : String(error),
            { code: "auth_required" },
          );
        }
        throw error;
      }

      const now = Date.now();
      const auth = await getConnectionAuthInfo(client);
      if (this.closed) {
        // Shutdown proceeded past its bounded quiesce grace while this
        // connect was still in flight; the disconnectAll snapshot has already
        // run, so registering now would leak a live transport/child process
        // past daemon exit. Tear the fresh client down instead.
        await safeDisconnect(client);
        this.assertOpen();
      }
      if (signal?.aborted) {
        // Caller hung up after the connect completed but before
        // registration; keeping the client would leak a live connection
        // nobody asked to retain.
        await safeDisconnect(client);
        throw connectCancelledError();
      }
      this.connections.set(params.name, {
        name: params.name,
        serverIdentity: params.serverIdentity,
        connectedAt: now,
        lastAccessedAt: now,
        client,
        serverConfig: params.serverConfig,
        ...(params.serverSettings && { serverSettings: params.serverSettings }),
        ...(auth && { auth }),
      });
      this.mruName = params.name;

      return {
        name: params.name,
        serverIdentity: params.serverIdentity,
        connectedAt: now,
        lastAccessedAt: now,
        isMru: true,
        protocolEra: client.getProtocolEra(),
        ...(auth && { auth }),
      };
    } finally {
      this.pendingConnects--;
      // Re-arm on any exit. On success the registered connection makes this
      // a no-op; on failure (createConnectionClient, reconnect disconnect,
      // client.connect, …) it restores self-reaping — but only once no other
      // connect is still in flight.
      this.armIdleTimerIfEmpty();
    }
  }

  async disconnect(
    name: string | undefined,
    requireExplicit: boolean | undefined,
  ): Promise<{ name: string }> {
    const connectionName = this.resolve(name, requireExplicit).name;
    return this.withNameLock(connectionName, () =>
      this.disconnectLocked(connectionName),
    );
  }

  private async disconnectLocked(
    connectionName: string,
  ): Promise<{ name: string }> {
    // Re-resolve under the lock: a queued duplicate disconnect must fail
    // with connection_not_found, not tear down a successor's connection.
    const connection = this.resolve(connectionName, true);
    this.connections.delete(connectionName);
    if (this.mruName === connectionName) {
      // Promote the next most-recently-accessed connection, if any.
      const remaining = [...this.connections.values()].sort(
        (a, b) => b.lastAccessedAt - a.lastAccessedAt,
      );
      this.mruName = remaining[0]?.name ?? null;
    }
    await safeDisconnect(connection.client);
    this.armIdleTimerIfEmpty();
    return { name: connectionName };
  }

  async disconnectAll(): Promise<void> {
    this.closed = true;
    const names = [...this.connections.keys()];
    for (const name of names) {
      await this.disconnect(name, false);
    }
    this.clearIdleTimer();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new CliExitCodeError(
        EXIT_CODES.UNREACHABLE,
        "Connection daemon is shutting down.",
        { code: "daemon_stopping" },
      );
    }
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    if (this.idleMs <= 0 || !this.onIdle) return;
    this.idleDeadline = Date.now() + this.idleMs;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.idleDeadline = null;
      if (this.connections.size === 0 && this.pendingConnects === 0) {
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
export function isConnectionAuthRequiredError(error: unknown): boolean {
  if (
    error instanceof AuthRecoveryRequiredError ||
    isUnauthorizedError(error)
  ) {
    return true;
  }
  // EMA misconfiguration (no/disabled install-level IdP) must surface via the
  // front-end too: authorizeInFrontend re-hits it in-process and maps it to
  // actionable mcpdo guidance, instead of this daemon relaying the web-centric
  // core message in an opaque error envelope.
  if (isEmaClientNotConfiguredError(error)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    /prepareTokenRequest\(\) or authorizationCode is required/i.test(message) ||
    /redirectUrl is required for authorization_code/i.test(message) ||
    /No code verifier saved for connection/i.test(message)
  );
}

/**
 * Maps a persisted/overridden `elicitCapability` mode onto the `elicit` shape
 * `InspectorClient` expects. Absence reads back as {@link
 * DEFAULT_ELICIT_CAPABILITY} (`"both"`), matching the pre-#1783 hardcoded
 * default so existing connections keep behaving the same until a caller opts
 * into something narrower via `--elicit` or a catalog entry's
 * `elicitCapability` field.
 */
export function elicitCapabilityToClientOption(
  mode: ElicitCapabilityMode | undefined,
): InspectorClientOptions["elicit"] {
  switch (mode ?? DEFAULT_ELICIT_CAPABILITY) {
    case "off":
      return false;
    case "url":
      return { url: true };
    case "form":
      return { form: true };
    case "both":
      return { url: true, form: true };
  }
}

/**
 * Project the core `OAuthConnectionState` down to the slim
 * {@link ConnectionAuthInfo} reported on `ConnectionInfo`.
 */
function projectAuthState(state: OAuthConnectionState): ConnectionAuthInfo {
  return {
    method: state.protocol === "ema" ? "ema" : "oauth",
    authorized: state.authorized,
    ...(state.grantedScope && { scope: state.grantedScope }),
    ...(state.client?.clientId && { clientId: state.client.clientId }),
    ...(state.ema?.idpSession && { idpSession: state.ema.idpSession }),
  };
}

/**
 * Connect-time auth snapshot, read through the live client's own storage.
 * Undefined for stdio servers and HTTP servers that never engaged OAuth
 * (`getOAuthState()` returns undefined for both), so no-auth connections simply
 * omit the field. Best-effort: a storage read failure must never fail the
 * connect that already succeeded.
 */
export async function getConnectionAuthInfo(
  client: InspectorClient,
): Promise<ConnectionAuthInfo | undefined> {
  let state;
  try {
    state = await client.getOAuthState();
  } catch {
    return undefined;
  }
  if (!state) return undefined;
  return projectAuthState(state);
}

/**
 * Live auth snapshot for `connections/show`, read from *disk* rather than the
 * client's storage. `NodeOAuthStorage` is load-once/memory-authoritative, so
 * the live client never observes cross-process changes to `oauth.json` (an
 * `auth/clear`, `auth/ema-logout`, or a web-client re-auth) — a fresh storage
 * after a cache reset does. Mirrors `OAuthManager.getOAuthState()`'s inputs:
 * the oauth config assembled from client.json + the saved server settings.
 * Best-effort: any failure falls back to the connect-time snapshot's absence
 * semantics (undefined).
 */
export async function getLiveConnectionAuthInfo(connection: {
  serverConfig: MCPServerConfig;
  serverSettings?: InspectorServerSettings;
}): Promise<ConnectionAuthInfo | undefined> {
  try {
    const config = connection.serverConfig;
    if (!isOAuthCapableServerConfig(config)) return undefined;
    const serverUrl = "url" in config ? config.url : undefined;
    if (typeof serverUrl !== "string" || serverUrl === "") return undefined;
    resetNodeOAuthStorageCache();
    const storage = new NodeOAuthStorage();
    const clientConfig = await loadRunnerClientConfig({});
    const authOptions = buildRunnerClientAuthOptions(
      clientConfig,
      connection.serverSettings,
      {},
    );
    const oauthConfig = authOptions.oauth ?? {};
    if (
      !isServerOAuthConfigured(oauthConfig) &&
      !(await hasPersistedOAuthServerState(storage, serverUrl))
    ) {
      return undefined;
    }
    return projectAuthState(
      await buildOAuthConnectionState({
        serverUrl,
        protocol: protocolFromOAuthConfig(oauthConfig),
        configuredScope: oauthConfig.scope,
        enterpriseManagedAuth: authOptions.enterpriseManagedAuth,
        storage,
      }),
    );
  } catch {
    return undefined;
  }
}

async function createConnectionClient(
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
      name: CONNECTION_CLIENT_NAME,
      version: readInspectorVersion(import.meta.url),
    },
    initialLoggingLevel: "debug",
    progress: false,
    sample: false,
    // Elicitation capability advertised to the server: derived from
    // `serverSettings.elicitCapability` (settable via a catalog entry or the
    // `--elicit` connect flag), defaulting to url+form when unset. A server
    // that ignores our (possibly empty) capabilities and elicits anyway is
    // defensively auto-declined by the daemon's elicitation prompt.
    elicit: elicitCapabilityToClientOption(serverSettings?.elicitCapability),
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

/**
 * Run a cancellable async operation. Guards the whole class of
 * abort-listener races: `AbortSignal` does not replay its event, so any
 * "check aborted, await something, then addEventListener" sequence can miss
 * an abort that fired in the gap and hang forever. Here the aborted check is
 * synchronous and the listener is installed *before* the operation starts,
 * so no abort can interleave. When aborted pre-start the operation is never
 * invoked; when aborted mid-flight its eventual settlement is still
 * observed by the race handlers, so nothing rejects unhandled.
 */
async function withAbort<T>(
  start: () => Promise<T>,
  signal: AbortSignal | undefined,
  makeError: () => Error,
): Promise<T> {
  if (!signal) return start();
  if (signal.aborted) throw makeError();
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(makeError());
    signal.addEventListener("abort", onAbort, { once: true });
    start().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Error thrown when a connect is abandoned because the requesting client's
 * socket closed. The response is written to a dead socket, so the exit code
 * only matters for in-process callers; UNREACHABLE ("no connection was
 * established") is the closest fit.
 */
function connectCancelledError(): CliExitCodeError {
  return new CliExitCodeError(
    EXIT_CODES.UNREACHABLE,
    "Connect cancelled: the requesting client disconnected while the connection was still in progress.",
    { code: "connect_cancelled" },
  );
}
