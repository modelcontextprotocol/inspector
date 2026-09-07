import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import { notifications } from "@mantine/notifications";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import type {
  ConnectionStatus,
  InspectorServerSettings,
  MCPServerConfig,
  ServerEntry,
} from "@inspector/core/mcp/types.js";
import {
  DEFAULT_MAX_FETCH_REQUESTS,
  eraToVersionNegotiation,
} from "@inspector/core/mcp/types.js";
import {
  applyStdioSettingsToConfig,
  cleanRoots,
  oauthAuthorizationParamsFromSettings,
  oauthEndpointOverridesFromSettings,
} from "@inspector/core/mcp/serverList.js";
import type { ClientConfig } from "@inspector/core/client/types.js";
import {
  getActiveCimdClientMetadataUrl,
  getActiveEnterpriseManagedAuthIdp,
} from "@inspector/core/client/types.js";
import { isEmaClientNotConfiguredError } from "@inspector/core/auth/ema/clientConfigError.js";
import { showInsecureTokenEndpointNotice } from "../lib/insecureTokenEndpointNotice";
import { findInsecureTokenEndpoint } from "@inspector/core/auth/insecureTokenEndpoint.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import type { RemoteInspectorClientStorage } from "@inspector/core/mcp/remote/index.js";
import type { SessionRef } from "./useSessionRef";
import type { FetchLogOptions } from "./useInspectorStores";
import type { LastPersistedSettings } from "./useLastPersistedSettings";
import type { AppElicitationSession } from "../lib/appElicitationController";
import type {
  PrepareOAuthRedirectArgs,
  ReAuthBannerState,
  SetupClientForServer,
} from "./useOAuthRecovery";
import { clearScrollMemory } from "./useScrollMemory";
import { createWebEnvironment } from "../lib/environmentFactory";
import { clearOAuthResumeSnapshot } from "../lib/oauthResume";
import { clearServerOAuthState } from "../lib/clearServerOAuthState";
import type { getWebRemoteOAuthStorage } from "../lib/remoteOAuthStorage";
import { getAuthToken, redirectUrlProvider } from "../lib/authToken";
import { OAUTH_CALLBACK_PATH, isUnauthorizedError } from "../utils/oauthFlow";
import { authRecoveryRestoredMessage } from "../utils/oauthUx";
import { deepLinkConfigEquals } from "../utils/deepLink";
import type { DeepLink } from "../utils/deepLink";

/**
 * Handshake telemetry: the "connecting" edge stamps `connectStartRef` and the
 * "connected" edge consumes it into `latencyMs`.
 *
 * Split out of `useConnectionLifecycle` below only because of call order.
 * `useOAuthRecovery` stamps the same ref — its `/oauth/callback` reconnect is a
 * connect attempt like any other — and runs *before* the lifecycle hook, so the
 * ref has to exist earlier than the hook that otherwise owns it. Keeping the
 * pair here rather than in `App.tsx` keeps both halves in the file that owns
 * connecting.
 */
export function useHandshakeTelemetry(connectionStatus: ConnectionStatus): {
  connectStartRef: RefObject<number | undefined>;
  latencyMs: number | undefined;
} {
  const connectStartRef = useRef<number | undefined>(undefined);
  const [latencyMs, setLatencyMs] = useState<number | undefined>(undefined);

  // Capture observed handshake latency at the connecting → connected edge.
  // Reset when the status leaves "connected" so the next connect starts
  // clean (otherwise a stale latency would render on the next session).
  useEffect(() => {
    if (
      connectionStatus === "connected" &&
      connectStartRef.current !== undefined
    ) {
      setLatencyMs(Date.now() - connectStartRef.current);
      connectStartRef.current = undefined;
    } else if (connectionStatus !== "connected") {
      setLatencyMs(undefined);
    }
  }, [connectionStatus]);

  return { connectStartRef, latencyMs };
}

/**
 * The narrow reset surface `useConnectionLifecycle` takes from each hook that
 * owns a slice of session-scoped UI state, rather than the individual setters.
 *
 * Taking the setters one at a time would make this hook depend on nearly
 * everything phase 1 extracted, which would decouple nothing (#2129).
 */
export interface SessionResetSurface {
  /** Drops the in-flight tool / prompt / resource result panels. */
  clearResultPanels: () => void;
  /** Clears per-screen selection, search and filter state. */
  resetTabUiState: () => void;
  /** Clears the taskId → progress map. */
  resetTaskProgress: () => void;
  /** Drops the re-auth banner and both pending-OAuth slots. */
  resetOAuthRecoveryState: () => void;
  /** Re-seeds both log-level controls for the outgoing session. */
  resetLogLevels: () => void;
  /** Closes the Connection Info modal so it can't pop back on reconnect. */
  closeConnectionInfoModal: () => void;
}

export interface UseConnectionLifecycleOptions {
  /** The stable session mirror from `useSessionRef` (#2129). */
  sessionRef: SessionRef;
  servers: ServerEntry[];
  activeServerId: string | undefined;
  inspectorClient: InspectorClient | null;
  connectionStatus: ConnectionStatus;
  /** Catalog writes the deep-link auto-connect performs before connecting. */
  addServer: (id: string, config: MCPServerConfig) => Promise<unknown>;
  updateServer: (
    id: string,
    nextId: string,
    config: MCPServerConfig,
  ) => Promise<unknown>;
  setActiveServerId: (id: string | undefined) => void;
  /** Red-borders a server in the list (#1621). */
  setFailedServerId: (id: string | undefined) => void;
  /** Publishes the client this hook constructs back to `App.tsx`. */
  setInspectorClient: (client: InspectorClient | null) => void;
  /** Per-session state managers, torn down and rebuilt around each connect. */
  createStores: (
    client: InspectorClient,
    fetchLogOptions: FetchLogOptions,
  ) => void;
  destroyStores: () => void;
  /** What each settings write actually put on disk, per server (#2089). */
  lastPersistedSettings: Pick<LastPersistedSettings, "resolve">;
  /** Install-level client config — the EMA idp and CIMD URL come from it. */
  clientConfig: ClientConfig;
  /**
   * Opens an app-rendered elicitation session for a newly built client, and
   * returns the renderer the client advertises the capability with (#1854).
   */
  newAppElicitationSession: () => AppElicitationSession;
  /**
   * The MCP Apps sandbox URL, or `undefined` once `/api/config` has settled
   * and reported none. Whether the client may advertise the nested
   * `elicitation` capability is decided at construction from this (#1854).
   */
  sandboxUrl: string | undefined;
  /**
   * Resolves once `/api/config` has settled, so a connect waits for the
   * sandbox answer rather than guessing it.
   */
  initialConfigSettledRef: RefObject<{ promise: Promise<void> } | null>;
  /** Handshake telemetry from `useHandshakeTelemetry` above. */
  connectStartRef: RefObject<number | undefined>;
  /**
   * Where the `/oauth/callback` rebuild reads the connect path from. Published
   * here in a layout effect; see `useOAuthRecovery` for why it is a ref.
   */
  setupClientForServerRef: RefObject<SetupClientForServer | null>;
  /** The validated deep link, or `undefined` when the URL carries none. */
  deepLink: DeepLink | undefined;

  // --- The OAuth recovery surface this hook consumes (#2153). ---
  webOAuthStorage: ReturnType<typeof getWebRemoteOAuthStorage>;
  sessionStorageAdapter: RemoteInspectorClientStorage;
  onBeforeOAuthRedirect: (authorizationUrl: URL) => void;
  prepareOAuthRedirect: (args: PrepareOAuthRedirectArgs) => void;
  finalizeExplicitDisconnect: () => void;
  reAuthBanner: ReAuthBannerState | null;
  setReAuthBanner: (next: ReAuthBannerState | null) => void;

  /** See `SessionResetSurface`. */
  sessionReset: SessionResetSurface;
  /** Seeds the modern per-request log level from a server's settings. */
  seedModernLogLevel: (settings: InspectorServerSettings | undefined) => void;
}

export interface ConnectionLifecycle {
  /** The server that just connected — drives its card's green highlight. */
  connectedServerId: string | undefined;
  /** Last connection-level failure, surfaced as `data-error-message`. */
  connectErrorMessage: string | undefined;
  /** Connect to `id`, or disconnect when it is already the live session. */
  onToggleConnection: (id: string) => Promise<void>;
  /** Header Disconnect: end the live session explicitly. */
  onDisconnect: () => Promise<void>;
  /** Re-auth banner action — retry, or clear stale state and reconnect. */
  onReauthenticateFromBanner: () => void;
}

/**
 * The whole connection lifecycle: constructing the `InspectorClient` for a
 * server, connecting and disconnecting it, the effects that observe those
 * transitions, and the session-scoped reset a disconnect triggers. Lifted out
 * of `App.tsx` by phase-2 step 3 of the decomposition (#2154, under
 * #2129/#2126).
 *
 * It is one hook because the pieces share the same edge. `setupClientForServer`
 * is the single place a connection is configured, and every entry point — the
 * user's toggle, the header's Disconnect, the deep-link auto-connect, the
 * re-auth banner, and (through `setupClientForServerRef`) the
 * `/oauth/callback` rebuild — has to reach the *same* one, or two of them
 * would build differently-configured clients for one server.
 *
 * Direction is one-way, as it was for `useOAuthRecovery`: this hook consumes
 * that one's redirect plumbing (`onBeforeOAuthRedirect`,
 * `sessionStorageAdapter`, `prepareOAuthRedirect`) and never the reverse. The
 * one thing OAuth recovery needs from here — rebuilding a client — is injected
 * back through `setupClientForServerRef`, published in a *layout* effect so it
 * is set before any passive effect of the same commit can read it.
 */
export function useConnectionLifecycle({
  sessionRef,
  servers,
  activeServerId,
  inspectorClient,
  connectionStatus,
  addServer,
  updateServer,
  setActiveServerId,
  setFailedServerId,
  setInspectorClient,
  createStores,
  destroyStores,
  lastPersistedSettings,
  clientConfig,
  newAppElicitationSession,
  sandboxUrl,
  initialConfigSettledRef,
  connectStartRef,
  setupClientForServerRef,
  deepLink,
  webOAuthStorage,
  sessionStorageAdapter,
  onBeforeOAuthRedirect,
  prepareOAuthRedirect,
  finalizeExplicitDisconnect,
  reAuthBanner,
  setReAuthBanner,
  sessionReset,
  seedModernLogLevel,
}: UseConnectionLifecycleOptions): ConnectionLifecycle {
  // Track the just-connected server so its card gets the green highlight +
  // scroll-into-view (#1682). It is a pure function of the two values it reads,
  // so it is derived rather than mirrored into state by an effect: a state copy
  // could only ever lag the status it copies by one committed render, which is
  // a frame of the wrong highlight for no gain.
  const connectedServerId =
    connectionStatus === "connected" ? activeServerId : undefined;

  // `setupClientForServer` is synchronous and memoized, so a caller that
  // awaited the config would still resume with the `sandboxUrl` captured by the
  // render it STARTED in — undefined, on the very load this matters for. The
  // ref carries the latest value instead, so client construction reads the
  // current one whichever entry point (connect, deep link, OAuth callback)
  // reached it. Published from a layout effect rather than written during
  // render: every reader is an event handler or a passive effect, both of which
  // run after the commit this writes in, so the value they see is unchanged.
  const sandboxUrlRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    sandboxUrlRef.current = sandboxUrl;
  }, [sandboxUrl]);

  const {
    clearResultPanels,
    resetTabUiState,
    resetTaskProgress,
    resetOAuthRecoveryState,
    resetLogLevels,
    closeConnectionInfoModal,
  } = sessionReset;

  const deepLinkEnsureRef = useRef(false);
  const deepLinkUpdateRef = useRef(false);
  const deepLinkConnectRef = useRef(false);

  // Disconnect the previous InspectorClient when it's replaced (server
  // switch) or when App unmounts (HMR, tests). Without this the prior
  // session's transport — a spawned stdio subprocess, an SSE stream, or
  // an HTTP session — stays open until GC eventually lets go. The
  // state-manager destroys in `setupClientForServer` only handle the
  // listener side; this effect handles the transport side. `disconnect()`
  // is the canonical lifecycle hook (InspectorClient has no `destroy()`);
  // it closes the transport, clears subscriptions, cancels receiver TTLs.
  useEffect(() => {
    return () => {
      if (inspectorClient) {
        void inspectorClient.disconnect();
      }
    };
  }, [inspectorClient]);

  // Reset the session-scoped UI state that lives outside the per-server state
  // managers, so the next server's screens don't show server A's last result.
  // The per-call panels (`toolCallState` / `getPromptState` /
  // `readResourceState`) and the optimistic log levels all survive a
  // disconnect/reconnect cycle otherwise — see #1368. `latencyMs` is
  // intentionally excluded: it resets via the `connectionStatus` effect in
  // `useHandshakeTelemetry`, which has its own connecting-edge ref to
  // coordinate with. Each piece is dropped through its owner's `reset()`
  // rather than through that owner's setters, so this stays one call per
  // owner as more session-scoped state accrues (#1394, #2129).
  // Does not clear the OAuth resume snapshot — that is tied to an in-flight
  // full-page redirect and is cleared on explicit disconnect or consumed on callback.
  const resetSessionScopedUiState = useCallback(() => {
    clearResultPanels();
    resetTabUiState();
    resetTaskProgress();
    resetLogLevels();
    resetOAuthRecoveryState();
    // Remembered scroll offsets are session-scoped too — drop them so the next
    // session's screens start at the top (#1417).
    clearScrollMemory();
  }, [
    clearResultPanels,
    resetTabUiState,
    resetTaskProgress,
    resetLogLevels,
    resetOAuthRecoveryState,
  ]);

  // Reset activeServerId whenever the live session ends. Without this the
  // other ServerCards stay `inert` after disconnect — ServerCard dims any
  // card whose id differs from `activeServer`. Subscribing to
  // InspectorClient's own `disconnect` event covers all three paths
  // (explicit toggle, header Disconnect button, mid-session transport
  // failure / process exit) and avoids the first-render-clobbers-new-id
  // trap that watching connectionStatus has (status starts as
  // "disconnected" for the new client before connect() runs). The
  // session-scoped panel/level reset rides along here too via
  // `resetSessionScopedUiState`.
  useEffect(() => {
    if (!inspectorClient) return;
    const onDisconnect = () => {
      setActiveServerId(undefined);
      // Drop the open flag too — without this the modal would pop back the
      // next time `initializeResult` re-becomes truthy (e.g. reconnect).
      closeConnectionInfoModal();
      resetSessionScopedUiState();
    };
    inspectorClient.addEventListener("disconnect", onDisconnect);
    return () => {
      inspectorClient.removeEventListener("disconnect", onDisconnect);
    };
  }, [
    inspectorClient,
    setActiveServerId,
    closeConnectionInfoModal,
    resetSessionScopedUiState,
  ]);

  // Last connection-level error message, surfaced as `data-error-message` on
  // the InspectorView header so an automated driver can read *why* a connect
  // failed without scraping a transient toast. Cleared on the next connect
  // attempt and on successful connection.
  const [connectErrorMessage, setConnectErrorMessage] = useState<
    string | undefined
  >(undefined);
  // Named writer so a single call site can be extended later (e.g. telemetry)
  // and the intent (record a connection-level failure) stays explicit.
  const recordConnectError = useCallback((message: string) => {
    setConnectErrorMessage(message);
  }, []);

  // Wire up + tear down per active server. Called by `onToggleConnection`
  // when the user switches targets. Returns the new client so the toggle
  // can call `connect()` against it before React re-renders.
  const setupClientForServer = useCallback(
    (server: ServerEntry, sessionId?: string): InspectorClient => {
      // Tear down the previous session's managers before building the new
      // client — each destroy() unsubscribes from the old client's events, and
      // doing it here (rather than leaving it to `createStores` below, which
      // also tears down whatever is live) means a throw while constructing the
      // client leaves nothing still listening to the outgoing one. A no-op on
      // the first call.
      destroyStores();

      const { environment, logger } = createWebEnvironment(
        getAuthToken(),
        redirectUrlProvider,
        onBeforeOAuthRedirect,
      );
      // The settings node persisted in mcp.json for this server — distinct
      // from the InspectorClient options we're about to derive from it.
      //
      // Through the tracker, not `server.settings` directly: the entry only
      // advances on a successful list read, so a write that landed while reads
      // were failing — including one made from the settings modal for a server
      // that was not connected at the time — would otherwise be undone at the
      // next connect, which builds the client from that frozen entry. This is
      // the one place the whole connection is configured, so every construction
      // path (connect, reconnect, OAuth resume) goes through it (#2089).
      const savedSettings =
        lastPersistedSettings.resolve(server.id) ?? server.settings;
      const activeIdp = getActiveEnterpriseManagedAuthIdp(clientConfig);
      const activeCimdUrl = getActiveCimdClientMetadataUrl(clientConfig);
      // Flatten the persisted settings into the InspectorClient options shape.
      // Empty / zero values stay unset so the SDK defaults apply.
      // Per-server default `_meta` is already a JSON object (#1910) — no
      // pair-array flattening left to do; `{}` means "no defaults".
      const defaultMetadata = savedSettings?.metadata;
      const serverAuthorizationParams = savedSettings
        ? oauthAuthorizationParamsFromSettings(savedSettings)
        : undefined;
      const serverEndpointOverrides = savedSettings
        ? oauthEndpointOverridesFromSettings(savedSettings)
        : undefined;
      const oauthFromServer =
        savedSettings &&
        (savedSettings.oauthClientId ||
          savedSettings.oauthClientSecret ||
          savedSettings.oauthScopes ||
          serverAuthorizationParams ||
          serverEndpointOverrides ||
          savedSettings.enterpriseManaged ||
          savedSettings.oauthRequestRefreshToken === false)
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
              ...(serverAuthorizationParams && {
                authorizationParams: serverAuthorizationParams,
              }),
              ...serverEndpointOverrides,
              ...(savedSettings.enterpriseManaged && {
                enterpriseManaged: true,
              }),
              // #2068: only the explicit opt-out is forwarded; omitting the key
              // leaves the provider's default (declare `refresh_token`) in place.
              ...(savedSettings.oauthRequestRefreshToken === false && {
                requestRefreshToken: false,
              }),
            }
          : undefined;
      const oauth =
        oauthFromServer || activeCimdUrl
          ? {
              ...(oauthFromServer ?? {}),
              ...(activeCimdUrl && { clientMetadataUrl: activeCimdUrl }),
            }
          : undefined;
      // The stdio `env` / `cwd` are edited as *settings* but stored on — and
      // read by the transport from — *config*, so the tracker's account of the
      // former has to be carried onto the latter. `server.config` comes off the
      // same frozen `servers` entry `server.settings` does, so without this a
      // save that landed while list reads were failing spawns the child process
      // with the pre-save environment while the modal, re-seeded from the
      // tracker, shows the new one (#2096). Same mapping the PUT route applies
      // when persisting it, from the same helper.
      const effectiveConfig = applyStdioSettingsToConfig(
        server.config,
        savedSettings,
      );
      const client = new InspectorClient(effectiveConfig, {
        environment,
        // The Tasks tab needs the receiver-task pipeline; the
        // requestor-task list comes from the client's task store.
        receiverTasks: true,
        // Sampling / elicitation are on by default; keep the parameterized
        // options off until the UI grows the surface to render them.
        elicit: { form: true, url: true },
        // Web only, and only when the sandbox renderer is actually available:
        // supplying this advertises the nested MCP Apps `elicitation`
        // capability, and a client that cannot host an app must not claim it
        // (#1854). Callers await `initialConfigSettled` first, so `sandboxUrl`
        // here means "confirmed absent" rather than "not known yet" — a
        // connection that reaches this with no sandbox behaves like the
        // CLI/TUI: native elicitation queue, no claim made to the server.
        ...(sandboxUrlRef.current && {
          appElicitation: newAppElicitationSession().render,
        }),
        // Always advertise the roots capability (even with no configured
        // roots) so the server can issue roots/list and receive
        // roots/list_changed; the configured roots are the answer to
        // roots/list. Empty-uri rows are dropped before they reach the wire.
        roots: cleanRoots(savedSettings?.roots ?? []),
        ...(savedSettings &&
          savedSettings.requestTimeout > 0 && {
            timeout: savedSettings.requestTimeout,
          }),
        ...(defaultMetadata &&
          Object.keys(defaultMetadata).length > 0 && {
            defaultMetadata,
          }),
        ...(oauth && { oauth }),
        ...(activeIdp && {
          enterpriseManagedAuth: { idp: activeIdp },
        }),
        ...(clientConfig.enterpriseManagedAuth && {
          installEnterpriseManagedAuth: clientConfig.enterpriseManagedAuth,
        }),
        ...(savedSettings && { serverSettings: savedSettings }),
        // Per-server protocol era (SEP §7.8) → SDK versionNegotiation. Absent
        // settings or an unset era default to legacy inside
        // eraToVersionNegotiation / the InspectorClient constructor (#1626).
        ...(savedSettings?.protocolEra && {
          versionNegotiation: eraToVersionNegotiation(
            savedSettings.protocolEra,
          ),
        }),
        // Per-server advertised-extension overrides (#1739). Absent/empty falls
        // back to the registry defaults in the InspectorClient constructor.
        ...(savedSettings?.advertisedExtensions &&
          Object.keys(savedSettings.advertisedExtensions).length > 0 && {
            advertisedExtensions: savedSettings.advertisedExtensions,
          }),
        // Set on the `/oauth/callback` rebuild so the client's `saveSession`
        // events (and any later persistence) key off the same OAuth authId
        // the pre-redirect page saved under.
        ...(sessionId && { sessionId }),
      });

      setInspectorClient(client);
      // #1629: seed the live modern per-request log level from the server
      // setting so the Logs-tab control reflects what the client stamps by
      // default (the client was seeded the same way in its constructor). "off"
      // means not opted in (null). Only affects modern connections.
      seedModernLogLevel(savedSettings);
      // Wire session storage so the fetch log survives the OAuth redirect.
      // When `sessionId` is supplied (the `/oauth/callback` rebuild) the prior
      // page's `auth` entries are restored on construction; the actual save is
      // driven synchronously from `onBeforeOAuthRedirect` above (keyed by the
      // same authId). `createStores` points `fetchLogRef` at the new instance
      // so that hook reads the current log.
      createStores(client, {
        sessionStorage: sessionStorageAdapter,
        logger,
        maxFetchRequests:
          savedSettings?.maxFetchRequests ?? DEFAULT_MAX_FETCH_REQUESTS,
        ...(sessionId && { sessionId }),
      });

      return client;
    },
    [
      createStores,
      destroyStores,
      setInspectorClient,
      seedModernLogLevel,
      sessionStorageAdapter,
      onBeforeOAuthRedirect,
      clientConfig,
      newAppElicitationSession,
      lastPersistedSettings,
    ],
  );
  // Publish it to the `/oauth/callback` effect, which needs to rebuild the
  // client for the server that started the flow and cannot reach a callback
  // declared this far down.
  //
  // A *layout* effect, not a render-phase write and not a passive one. React
  // runs every layout effect before any passive effect of the same commit, and
  // the callback effect inside `useOAuthRecovery` is passive — so this is
  // always published before its first read, without the render-phase ref
  // mutation the compiler rule (rightly) rejects.
  useLayoutEffect(() => {
    setupClientForServerRef.current = setupClientForServer;
  }, [setupClientForServerRef, setupClientForServer]);

  const onToggleConnection = useCallback(
    async (id: string) => {
      // Whether this client may advertise app-rendered elicitation is decided
      // at construction and cannot be revised afterwards, so wait for the fact
      // rather than guess it (see `initialConfigSettledRef`). Already resolved
      // by the time any human clicks; this only orders a deep-link auto-connect
      // that races the same page load.
      await initialConfigSettledRef.current?.promise;
      // Same server, already connected → disconnect.
      if (
        id === activeServerId &&
        connectionStatus === "connected" &&
        inspectorClient
      ) {
        try {
          await inspectorClient.disconnect();
        } finally {
          finalizeExplicitDisconnect();
        }
        return;
      }

      // Read from the ref so a caller that already awaited an
      // addServer/updateServer in the same async tick (e.g. the deep-link
      // auto-connect IIFE) sees the freshly-mutated list, not the stale array
      // captured by this callback's closure.
      const target = sessionRef.current.servers.find((s) => s.id === id);
      if (!target) return;

      // Always rebuild the InspectorClient on a (re)connect so the latest
      // `target.settings` (headers, metadata, timeouts, OAuth credentials)
      // are picked up. Reusing the previous client object would freeze the
      // settings at the moment it was first constructed, which would be
      // surprising right after the user edited them in the settings modal.
      const client = setupClientForServer(target);
      if (id !== activeServerId) {
        setActiveServerId(id);
      }
      // A new connection attempt has begun: clear any previous failure flag so
      // the red border on the last-failed card is removed (#1621). If this
      // attempt also fails, the catch below re-sets it for this server.
      setFailedServerId(undefined);
      // Clear the machine-readable connect error for the same reason; a fresh
      // attempt starts from a clean `data-error-message`.
      setConnectErrorMessage(undefined);

      connectStartRef.current = Date.now();
      try {
        // `settings.connectionTimeout` is consumed inside InspectorClient.connect
        // (Promise.race + transport teardown live there now), so this branch
        // stays unaware of the per-server timeout. TUI/CLI consumers get the
        // same behavior by reading from `serverSettings` on the client.
        await client.connect();
      } catch (err) {
        // Handshake-only. A mid-session transport failure does not throw; the
        // client's `error` event surfaces those, consumed via
        // `useInspectorClient`'s `lastError` and toasted in the effect above
        // (#1323).
        connectStartRef.current = undefined;

        if (isEmaClientNotConfiguredError(err)) {
          notifications.show({
            title: `Cannot connect to "${target.name}"`,
            message: err.message,
            color: "red",
            autoClose: false,
          });
          return;
        }
        // SEP-2207 (#2280): a token endpoint the SDK will not post credentials
        // to. Terminal, so it gets a notice of its own rather than the generic
        // "Failed to connect" toast, whose detail line would be the raw SDK
        // text.
        //
        // The teardown is load-bearing, not tidiness. `connect()` sets its
        // status to `"error"` and dispatches `statusChange` *before* rethrowing
        // (it is not a connect-auth-recovery error), and `InspectorView` pins
        // the monitoring sidebar open on that transition and paints the card
        // red. Returning without it would present this as the failed connect
        // attempt the notice explicitly says it is not. The `authenticate()`
        // arm below already disconnects for the same reason.
        if (findInsecureTokenEndpoint(err)) {
          await client.disconnect().catch(() => {});
          showInsecureTokenEndpointNotice(err, target.name);
          return;
        }

        // A 401 from an OAuth-protected server means we have no (valid) token
        // yet. Kick off the authorization-code flow: `authenticate()` runs
        // discovery + DCR (proxied through the backend), then redirects the
        // whole page to the auth server via `BrowserNavigation`. Persist the
        // initiating server id first so the `/oauth/callback` load can resume
        // against the right client. The redirect unloads this page, so there's
        // nothing to do after the await on the success path.
        if (err instanceof AuthRecoveryRequiredError) {
          try {
            if (await client.checkAuthChallengeSatisfied(err.authChallenge)) {
              connectStartRef.current = Date.now();
              await client.connect();
              return;
            }
          } catch (recoveryErr) {
            // Both awaits above are unguarded connect work sitting inside a
            // `catch`, so a rejection escapes `onToggleConnection` altogether:
            // no toast, no red border, no sidebar — the #2108 failure mode in
            // its most invisible form. Surface it as the failed connect attempt
            // it is. A throw from `checkAuthChallengeSatisfied` lands here too
            // rather than falling through to `prepareOAuthRedirect`: it is not
            // the same as the challenge being *unsatisfied*, and navigating the
            // whole page away on the strength of an error would bury it.
            connectStartRef.current = undefined;
            // Tear the session down before reporting, as the sibling OAuth
            // catch below does. The outer `connect()` rejected with an
            // auth-recovery error, which deliberately holds the status at
            // `"connecting"` rather than moving it to `"error"` — so if the
            // challenge check is what rejected, nothing else ever ends the
            // attempt and the toggle spins while the active-server lock is
            // held. The fetch log survives a disconnect, so the Network
            // diagnostics this issue is about are unaffected.
            await client.disconnect().catch(() => {});
            setFailedServerId(id);
            const message =
              recoveryErr instanceof Error
                ? recoveryErr.message
                : String(recoveryErr);
            setConnectErrorMessage(message);
            notifications.show({
              title: `Failed to connect to "${target.name}"`,
              message,
              color: "red",
            });
            return;
          }
          prepareOAuthRedirect({
            serverId: id,
            authKind: "reauth",
            authorizationUrl: err.authorizationUrl,
            preRedirectContext: "connect",
            client,
          });
          return;
        }

        if (isUnauthorizedError(err)) {
          try {
            const authUrl = await client.authenticate();
            if (authUrl === undefined) {
              connectStartRef.current = Date.now();
              await client.connect();
            } else {
              prepareOAuthRedirect({
                serverId: id,
                authKind: "reauth",
                authorizationUrl: authUrl,
                preRedirectContext: "connect",
                client,
              });
            }
            return;
          } catch (authErr) {
            clearOAuthResumeSnapshot();
            await client.disconnect().catch(() => {});
            if (isEmaClientNotConfiguredError(authErr)) {
              notifications.show({
                title: `Cannot connect to "${target.name}"`,
                message: authErr.message,
                color: "red",
                autoClose: false,
              });
              return;
            }
            // See the SEP-2207 note on the handshake arm above (#2280).
            if (showInsecureTokenEndpointNotice(authErr, target.name)) {
              return;
            }
            // The connect attempt failed, same as any other handshake error —
            // flag the card (#1621) and, with it, open the monitoring sidebar
            // onto the OAuth requests that explain the failure (#2108). This
            // leg never reaches the `"error"` connection status (the
            // `disconnect()` above settles it at `"disconnected"`), so this
            // flag is the only signal the view has that a connect attempt died.
            setFailedServerId(id);
            const message =
              authErr instanceof Error ? authErr.message : String(authErr);
            setConnectErrorMessage(message);
            notifications.show({
              title: `OAuth authorization failed for "${target.name}"`,
              message,
              color: "red",
            });
            return;
          }
        }

        // Non-auth handshake error: toast so the user sees what went wrong
        // instead of the ConnectionToggle silently reverting to
        // "disconnected", and flag the card with a red border (#1621).
        setFailedServerId(id);
        const message = err instanceof Error ? err.message : String(err);
        setConnectErrorMessage(message);
        notifications.show({
          title: `Failed to connect to "${target.name}"`,
          message,
          color: "red",
        });
      }
    },
    [
      sessionRef,
      activeServerId,
      connectionStatus,
      inspectorClient,
      initialConfigSettledRef,
      connectStartRef,
      setupClientForServer,
      setActiveServerId,
      setFailedServerId,
      prepareOAuthRedirect,
      finalizeExplicitDisconnect,
    ],
  );

  const onDisconnect = useCallback(async () => {
    if (!inspectorClient) return;
    try {
      await inspectorClient.disconnect();
    } finally {
      finalizeExplicitDisconnect();
    }
  }, [inspectorClient, finalizeExplicitDisconnect]);

  // Deep-link auto-connect (the URL-driven case of #1183). `useServers`
  // hydrates asynchronously (initial `servers` is `[]`), so this effect runs in
  // discrete phases keyed on what `servers` currently reflects, one per render:
  //   1. ensure — no row yet: one-shot `addServer`.
  //   2. update — row present but its persisted config differs from the deep
  //      link (a stale transport/url from an earlier load under the stable
  //      `deep-link` id): `updateServer`, then return so the effect re-runs.
  //   3. connect — row present AND its config already matches: connect.
  // Splitting update and connect across renders (rather than awaiting both in
  // one closure) is what makes the connect correct: `onToggleConnection` reads
  // the target from the session ref, which an earlier passive effect syncs from
  // `servers` — so connecting only once `servers` reflects the updated config
  // guarantees the client is built from the fresh transport, not the stale one.
  // The OAuth callback path takes precedence; a deep link on `/oauth/callback`
  // would be a misconfiguration, and the callback handler clears the URL.
  useEffect(() => {
    if (!deepLink) return;
    if (window.location.pathname === OAUTH_CALLBACK_PATH) return;

    const existing = servers.find((s) => s.id === deepLink.serverId);
    if (!existing) {
      if (deepLinkEnsureRef.current) return;
      deepLinkEnsureRef.current = true;
      void addServer(deepLink.serverId, deepLink.serverConfig).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        // A 409 ("already exists") means the row is on disk and hydration will
        // surface it on a later render, so the connect phase still proceeds —
        // swallow it. Any other failure (read-only catalog, backend 5xx) would
        // otherwise leave the deep link permanently stuck at this guard with no
        // signal, so record it on the machine-readable error surface.
        if (!message.includes("already exists")) recordConnectError(message);
      });
      return;
    }

    if (!deepLinkConfigEquals(existing.config, deepLink.serverConfig)) {
      if (deepLinkUpdateRef.current) return;
      deepLinkUpdateRef.current = true;
      void updateServer(
        deepLink.serverId,
        deepLink.serverId,
        deepLink.serverConfig,
      ).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        recordConnectError(message);
      });
      return;
    }

    if (deepLinkConnectRef.current) return;
    deepLinkConnectRef.current = true;
    // Connect unless we're already *connected* to the deep-link server. Gating
    // on `activeServerId` identity alone would skip the connect when a prior
    // session restored `activeServerId` to the `deep-link` id while the socket
    // is disconnected — a reload of the same deep-link URL would then silently
    // never connect. `onToggleConnection` only disconnects when the id is the
    // active one AND the status is connected, so this condition also avoids
    // toggling a live connection off.
    const alreadyConnected =
      activeServerId === deepLink.serverId && connectionStatus === "connected";
    if (!alreadyConnected) {
      // `onToggleConnection` is a connect, not a state sync: it opens a
      // transport and drives the whole handshake, so the state it sets along
      // the way is a consequence of that I/O rather than something derivable
      // from props. An effect is the right tool here, and the one-shot
      // `deepLinkConnectRef` guard above is what keeps it from re-firing; the
      // rule sees only that an effect called something that reaches setState.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- justified directly above
      void onToggleConnection(deepLink.serverId).catch((err) => {
        // The toast fires from inside `onToggleConnection` for the common
        // cases; this catch covers the rest (surfaced on `data-error-message`).
        const message = err instanceof Error ? err.message : String(err);
        recordConnectError(message);
      });
    }
  }, [
    deepLink,
    servers,
    activeServerId,
    connectionStatus,
    addServer,
    updateServer,
    onToggleConnection,
    recordConnectError,
  ]);

  /**
   * The banner's connect, terminated. `onToggleConnection` handles every
   * failure the *handshake* can produce, but client construction runs ahead of
   * its try/catch — so a throw there (a wedged store teardown, a config the
   * `InspectorClient` constructor rejects) escapes it. Both banner call sites
   * discard the promise, which would make that an unhandled rejection with the
   * banner already dismissed and nothing left to explain it.
   *
   * Recorded on `connectErrorMessage` rather than toasted, matching the
   * deep-link phases' own catch: the toggle already toasts everything it
   * handles, so a toast here would be new user-visible behavior in what is
   * otherwise an inert move.
   */
  const retryConnect = useCallback(
    async (serverId: string) => {
      try {
        await onToggleConnection(serverId);
      } catch (err) {
        recordConnectError(err instanceof Error ? err.message : String(err));
      }
    },
    [onToggleConnection, recordConnectError],
  );

  const onReauthenticateFromBanner = useCallback(() => {
    if (!reAuthBanner) return;
    const serverId = reAuthBanner.serverId;
    const bannerKind = reAuthBanner.kind;
    setReAuthBanner(null);

    // Lost-authorization-state recovery (#1808). The stale half of the flow
    // (code verifier without discovery state, possibly a stale registration)
    // would make a plain retry fail the same way, so drop the persisted OAuth
    // state for this server first, then start a fresh authorization. This
    // banner is only raised from the `/oauth/callback` failure path, where the
    // session never reached "connected", so connecting is always the right
    // toggle direction here.
    if (bannerKind === "lost_authorization_state") {
      void (async () => {
        const server = sessionRef.current.servers.find(
          (s) => s.id === serverId,
        );
        if (server) {
          try {
            await clearServerOAuthState({
              config: server.config,
              inspectorClient:
                serverId === activeServerId ? inspectorClient : null,
              isActiveConnection: serverId === activeServerId,
              oauthStorage: webOAuthStorage,
              // No RFC 7009 revocation here (#2144): this clears a *half-finished*
              // flow so it can be retried. The authorization never completed, so
              // there is no grant to revoke — and any token still on disk belongs
              // to the very session this recovery is trying to rebuild.
              revoke: false,
            });
          } catch (err) {
            notifications.show({
              title: "Could not clear the stored authorization state",
              message: err instanceof Error ? err.message : String(err),
              color: "red",
              // The banner is already dismissed and the flow is dead, so this
              // is the only remaining explanation — don't time it out.
              autoClose: false,
            });
            return;
          }
        }
        await retryConnect(serverId);
      })();
      return;
    }

    if (
      serverId === activeServerId &&
      connectionStatus === "connected" &&
      inspectorClient
    ) {
      void (async () => {
        const server = servers.find((s) => s.id === serverId);
        try {
          const authUrl = await inspectorClient.authenticate();
          if (authUrl === undefined) {
            await inspectorClient.pushRemoteAuthState();
            notifications.show({
              title: "Authorization restored",
              message: authRecoveryRestoredMessage(),
              color: "green",
              autoClose: 4000,
            });
            return;
          }
          prepareOAuthRedirect({
            serverId,
            authKind: "reauth",
            authorizationUrl: authUrl,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          notifications.show({
            title: server
              ? `OAuth authorization failed for "${server.name}"`
              : "OAuth authorization failed",
            message,
            color: "red",
          });
        }
      })();
      return;
    }

    void retryConnect(serverId);
  }, [
    sessionRef,
    reAuthBanner,
    retryConnect,
    activeServerId,
    connectionStatus,
    inspectorClient,
    servers,
    prepareOAuthRedirect,
    webOAuthStorage,
    setReAuthBanner,
  ]);

  return {
    connectedServerId,
    connectErrorMessage,
    onToggleConnection,
    onDisconnect,
    onReauthenticateFromBanner,
  };
}
