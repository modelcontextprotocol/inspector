import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useLayoutEffect, useRef } from "react";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import type {
  ConnectionStatus,
  InspectorServerSettings,
  MCPServerConfig,
  ServerEntry,
} from "@inspector/core/mcp/types.js";
import type { ClientConfig } from "@inspector/core/client/types.js";
import type { RemoteInspectorClientStorage } from "@inspector/core/mcp/remote/index.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import { EmaClientNotConfiguredError } from "@inspector/core/auth/ema/clientConfigError.js";
import { InsecureTokenEndpointError } from "@modelcontextprotocol/client";
import { renderWithMantine, act, waitFor } from "../test/renderWithMantine";
import { EMPTY_SETTINGS } from "../utils/serverSettingsDefaults";
import { DEEP_LINK_SERVER_ID } from "../utils/deepLink";
import type { DeepLink } from "../utils/deepLink";
import { useSessionRef } from "./useSessionRef";
import type { SetupClientForServer } from "./useOAuthRecovery";
import type { getWebRemoteOAuthStorage } from "../lib/remoteOAuthStorage";
import {
  useConnectionLifecycle,
  useHandshakeTelemetry,
  type ConnectionLifecycle,
  type SessionResetSurface,
} from "./useConnectionLifecycle";

// --- Module doubles ---------------------------------------------------------
// Everything the hook reaches outside React and outside the client: the toast
// layer, the web environment factory (which would otherwise build real
// transports), the auth token, and the OAuth-state clear. `InspectorClient`
// itself is NOT mocked — `setupClientForServer` exists to translate a server
// entry into that constructor's options, so a stand-in would leave the whole
// translation unverified. Its network-touching methods are spied on the
// prototype instead.

const { notificationsMock } = vi.hoisted(() => ({
  notificationsMock: { show: vi.fn(), update: vi.fn(), hide: vi.fn() },
}));
vi.mock("@mantine/notifications", () => ({ notifications: notificationsMock }));

const { environmentMock } = vi.hoisted(() => ({
  environmentMock: vi.fn(),
}));
vi.mock("../lib/environmentFactory", () => ({
  createWebEnvironment: (...args: unknown[]) => {
    environmentMock(...args);
    return { environment: {}, logger: { level: "silent" } };
  },
}));

const { clearServerOAuthStateMock } = vi.hoisted(() => ({
  clearServerOAuthStateMock: vi.fn(),
}));
vi.mock("../lib/clearServerOAuthState", () => ({
  clearServerOAuthState: clearServerOAuthStateMock,
}));

vi.mock("../lib/authToken", () => ({
  getAuthToken: () => "test-token",
  redirectUrlProvider: () => "http://localhost/oauth/callback",
}));

// --- Fixtures ---------------------------------------------------------------

const entry = (id: string, over: Partial<ServerEntry> = {}): ServerEntry => ({
  id,
  name: `Server ${id}`,
  config: { type: "streamable-http", url: "https://mcp.example/mcp" },
  connection: { status: "disconnected" },
  ...over,
});

const deepLinkConfig: MCPServerConfig = {
  type: "streamable-http",
  url: "https://deep.example/mcp",
};

const deepLink = (over: Partial<DeepLink> = {}): DeepLink => ({
  serverId: DEEP_LINK_SERVER_ID,
  serverConfig: deepLinkConfig,
  appArgs: {},
  autoOpen: false,
  ...over,
});

/**
 * A 401 the way the SDK surfaces one. `isUnauthorizedError` keys off the
 * status/code rather than the message, so a plain `Error("401")` would take
 * the non-auth arm and the test would pass for the wrong reason.
 */
const unauthorized = (): Error =>
  Object.assign(new Error("Unauthorized"), { status: 401 });

/** The one OAuth-storage member `clearServerOAuthState` is handed. */
const oauthStorage = {} as ReturnType<typeof getWebRemoteOAuthStorage>;
const sessionStorageAdapter = {} as RemoteInspectorClientStorage;

interface HarnessProps {
  servers?: ServerEntry[];
  activeServerId?: string;
  connectionStatus?: ConnectionStatus;
  /**
   * The live client, i.e. what App.tsx holds in `inspectorClient`. There is no
   * implicit "whatever was last constructed" fallback — the hook publishes
   * through `setInspectorClient`, which is a spy here, so a test that wants a
   * live session rerenders with the client it read back out of that spy (see
   * `lastClient`), the same render-later settle App.tsx has.
   */
  client?: InspectorClient | null;
  clientConfig?: ClientConfig;
  sandboxUrl?: string;
  /**
   * The `/api/config` gate a connect awaits. Defaults to already-settled;
   * supply a pending promise to hold a connect at that gate.
   */
  configSettled?: Promise<void>;
  deepLink?: DeepLink;
  reAuthBanner?: {
    serverId: string;
    message: string;
    kind?: "lost_authorization_state";
  } | null;
  /** Feeds `lastPersistedSettings.resolve`, which wins over `entry.settings`. */
  persisted?: Record<string, InspectorServerSettings | undefined>;
  addServerImpl?: (id: string, config: MCPServerConfig) => Promise<unknown>;
  updateServerImpl?: (
    id: string,
    nextId: string,
    config: MCPServerConfig,
  ) => Promise<unknown>;
}

function spies() {
  return {
    addServer: vi.fn().mockResolvedValue(undefined),
    updateServer: vi.fn().mockResolvedValue(undefined),
    setActiveServerId: vi.fn(),
    setFailedServerId: vi.fn(),
    setInspectorClient: vi.fn(),
    createStores: vi.fn(),
    destroyStores: vi.fn(),
    newAppElicitationSession: vi.fn(() => ({
      render: vi.fn(),
      close: vi.fn(),
    })),
    onBeforeOAuthRedirect: vi.fn(),
    prepareOAuthRedirect: vi.fn(),
    finalizeExplicitDisconnect: vi.fn(),
    setReAuthBanner: vi.fn(),
    seedModernLogLevel: vi.fn(),
    clearResultPanels: vi.fn(),
    resetTabUiState: vi.fn(),
    resetTaskProgress: vi.fn(),
    resetOAuthRecoveryState: vi.fn(),
    resetLogLevels: vi.fn(),
    closeConnectionInfoModal: vi.fn(),
  };
}

type Spies = ReturnType<typeof spies>;

interface Harness {
  api: () => ConnectionLifecycle;
  rerender: (next: HarnessProps) => void;
  spies: Spies;
  /** The `setupClientForServer` published to the OAuth callback path. */
  published: () => SetupClientForServer | null;
}

function harness(initial: HarnessProps = {}): Harness {
  let latest: ConnectionLifecycle | undefined;
  const s = spies();

  function Probe({ p }: { p: HarnessProps }) {
    const servers = p.servers ?? [];
    const sessionRef = useSessionRef({
      activeServerId: p.activeServerId,
      servers,
      inspectorClient: p.client ?? null,
    });
    // Held across renders and published from a layout effect, exactly as
    // App.tsx does — a fresh object per render would give the hook a changing
    // dependency the real one never has.
    const setupClientForServerRef = useRef<SetupClientForServer | null>(null);
    const initialConfigSettledRef = useRef<{ promise: Promise<void> }>(null);
    initialConfigSettledRef.current ??= {
      promise: p.configSettled ?? Promise.resolve(),
    };
    const sessionReset: SessionResetSurface = {
      clearResultPanels: s.clearResultPanels,
      resetTabUiState: s.resetTabUiState,
      resetTaskProgress: s.resetTaskProgress,
      resetOAuthRecoveryState: s.resetOAuthRecoveryState,
      resetLogLevels: s.resetLogLevels,
      closeConnectionInfoModal: s.closeConnectionInfoModal,
    };
    const { connectStartRef } = useHandshakeTelemetry(
      p.connectionStatus ?? "disconnected",
    );
    latest = useConnectionLifecycle({
      sessionRef,
      servers,
      activeServerId: p.activeServerId,
      inspectorClient: p.client ?? null,
      connectionStatus: p.connectionStatus ?? "disconnected",
      addServer: p.addServerImpl ?? s.addServer,
      updateServer: p.updateServerImpl ?? s.updateServer,
      setActiveServerId: s.setActiveServerId,
      setFailedServerId: s.setFailedServerId,
      setInspectorClient: s.setInspectorClient,
      createStores: s.createStores,
      destroyStores: s.destroyStores,
      lastPersistedSettings: {
        resolve: (id: string) => p.persisted?.[id],
      },
      clientConfig: p.clientConfig ?? {},
      newAppElicitationSession: s.newAppElicitationSession,
      sandboxUrl: p.sandboxUrl,
      initialConfigSettledRef,
      connectStartRef,
      setupClientForServerRef,
      deepLink: p.deepLink,
      webOAuthStorage: oauthStorage,
      sessionStorageAdapter,
      onBeforeOAuthRedirect: s.onBeforeOAuthRedirect,
      prepareOAuthRedirect: s.prepareOAuthRedirect,
      finalizeExplicitDisconnect: s.finalizeExplicitDisconnect,
      reAuthBanner: p.reAuthBanner ?? null,
      setReAuthBanner: s.setReAuthBanner,
      sessionReset,
      seedModernLogLevel: s.seedModernLogLevel,
    });
    useLayoutEffect(() => {
      publishedRef = setupClientForServerRef.current;
    });
    return null;
  }

  let publishedRef: SetupClientForServer | null = null;
  const { rerender } = renderWithMantine(<Probe p={initial} />);
  return {
    api: () => {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
    rerender: (next) => rerender(<Probe p={next} />),
    spies: s,
    published: () => publishedRef,
  };
}

/** The client `setupClientForServer` most recently constructed. */
const lastClient = (h: Harness): InspectorClient => {
  const calls = h.spies.setInspectorClient.mock.calls;
  const client = calls.at(-1)?.[0] as InspectorClient | null | undefined;
  if (!client) throw new Error("no client was constructed");
  return client;
};

const toastTitles = (): string[] =>
  notificationsMock.show.mock.calls.map((c) => String(c[0]?.title));

let connectSpy: ReturnType<typeof vi.spyOn>;
let disconnectSpy: ReturnType<typeof vi.spyOn>;
let authenticateSpy: ReturnType<typeof vi.spyOn>;
let checkSpy: ReturnType<typeof vi.spyOn>;
let pushAuthSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  connectSpy = vi
    .spyOn(InspectorClient.prototype, "connect")
    .mockResolvedValue(undefined);
  disconnectSpy = vi
    .spyOn(InspectorClient.prototype, "disconnect")
    .mockResolvedValue(undefined);
  authenticateSpy = vi
    .spyOn(InspectorClient.prototype, "authenticate")
    .mockResolvedValue(undefined);
  checkSpy = vi
    .spyOn(InspectorClient.prototype, "checkAuthChallengeSatisfied")
    .mockResolvedValue(false);
  pushAuthSpy = vi
    .spyOn(InspectorClient.prototype, "pushRemoteAuthState")
    .mockResolvedValue(undefined);
  clearServerOAuthStateMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("useHandshakeTelemetry", () => {
  function TelemetryProbe({
    status,
    onValue,
    start,
  }: {
    status: ConnectionStatus;
    onValue: (latency: number | undefined) => void;
    start?: number;
  }) {
    const { connectStartRef, latencyMs } = useHandshakeTelemetry(status);
    if (start !== undefined) connectStartRef.current = start;
    onValue(latencyMs);
    return null;
  }

  it("measures the connecting → connected edge and consumes the stamp", async () => {
    const seen: (number | undefined)[] = [];
    const onValue = (v: number | undefined) => seen.push(v);
    const { rerender } = renderWithMantine(
      <TelemetryProbe
        status="connecting"
        onValue={onValue}
        start={Date.now() - 50}
      />,
    );
    rerender(<TelemetryProbe status="connected" onValue={onValue} />);
    await waitFor(() => expect(seen.at(-1)).toBeGreaterThanOrEqual(50));
  });

  it("leaves the latency unset when the connected edge carries no stamp", async () => {
    const seen: (number | undefined)[] = [];
    const onValue = (v: number | undefined) => seen.push(v);
    renderWithMantine(<TelemetryProbe status="connected" onValue={onValue} />);
    await waitFor(() => expect(seen.at(-1)).toBeUndefined());
  });

  it("clears the latency once the session is no longer connected", async () => {
    const seen: (number | undefined)[] = [];
    const onValue = (v: number | undefined) => seen.push(v);
    const { rerender } = renderWithMantine(
      <TelemetryProbe
        status="connecting"
        onValue={onValue}
        start={Date.now() - 10}
      />,
    );
    rerender(<TelemetryProbe status="connected" onValue={onValue} />);
    await waitFor(() => expect(seen.at(-1)).not.toBeUndefined());
    rerender(<TelemetryProbe status="disconnected" onValue={onValue} />);
    await waitFor(() => expect(seen.at(-1)).toBeUndefined());
  });
});

describe("useConnectionLifecycle", () => {
  describe("setupClientForServer", () => {
    it("builds a client from the persisted settings, not the frozen entry", () => {
      const persistedSettings: InspectorServerSettings = {
        ...EMPTY_SETTINGS,
        requestTimeout: 4000,
        maxFetchRequests: 42,
        metadata: { tenant: "acme" },
        roots: [{ uri: "file:///work", name: "work" }],
        protocolEra: "modern",
        advertisedExtensions: { "io.modelcontextprotocol/tasks": true },
        oauthClientId: "cid",
        oauthClientSecret: "secret",
        oauthScopes: "a b",
        enterpriseManaged: true,
        oauthRequestRefreshToken: false,
      };
      const stale: InspectorServerSettings = {
        ...EMPTY_SETTINGS,
        requestTimeout: 1,
      };
      const h = harness({
        servers: [entry("a", { settings: stale })],
        persisted: { a: persistedSettings },
        sandboxUrl: "http://localhost:6275/sandbox",
        clientConfig: {
          enterpriseManagedAuth: {
            idp: { issuer: "https://idp.example", clientId: "ema-client" },
          },
        },
      });

      const client = h.published()!(entry("a", { settings: stale }));

      expect(client.getServerSettings()?.requestTimeout).toBe(4000);
      expect(client.getRoots()).toEqual([
        { uri: "file:///work", name: "work" },
      ]);
      expect(h.spies.destroyStores).toHaveBeenCalled();
      expect(h.spies.seedModernLogLevel).toHaveBeenCalledWith(
        persistedSettings,
      );
      expect(h.spies.createStores).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ maxFetchRequests: 42 }),
      );
      // The sandbox is present, so the nested MCP Apps elicitation session is
      // opened and the capability may be advertised (#1854).
      expect(h.spies.newAppElicitationSession).toHaveBeenCalled();
    });

    it("falls back to the entry's own settings and the default log size", () => {
      const h = harness({ servers: [entry("a")] });

      const client = h.published()!(entry("a"));

      expect(client.getServerSettings()).toBeUndefined();
      expect(h.spies.seedModernLogLevel).toHaveBeenCalledWith(undefined);
      expect(h.spies.createStores).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ maxFetchRequests: expect.any(Number) }),
      );
      // No sandbox URL — the client must not claim app-rendered elicitation.
      expect(h.spies.newAppElicitationSession).not.toHaveBeenCalled();
    });

    it("waits for the config gate, then reads the sandbox URL as of then", async () => {
      // The whole reason `onToggleConnection` awaits the gate and
      // `setupClientForServer` reads `sandboxUrlRef` rather than a captured
      // value: on the load this matters for, the connect starts before
      // `/api/config` has answered. Guessing "no sandbox" there would strand
      // the session on the native elicitation form despite having one.
      let settle!: () => void;
      const gate = new Promise<void>((resolve) => (settle = resolve));
      const props: HarnessProps = {
        servers: [entry("a")],
        configSettled: gate,
        sandboxUrl: undefined,
      };
      const h = harness(props);

      let toggled: Promise<void>;
      act(() => {
        toggled = h.api().onToggleConnection("a");
      });
      // Held at the gate — nothing constructed, nothing connected.
      expect(h.spies.setInspectorClient).not.toHaveBeenCalled();
      expect(connectSpy).not.toHaveBeenCalled();

      // `/api/config` answers: there IS a sandbox after all.
      h.rerender({ ...props, sandboxUrl: "http://localhost:6275/sandbox" });

      await act(async () => {
        settle();
        await toggled;
      });

      expect(connectSpy).toHaveBeenCalledTimes(1);
      // Built from the URL as of the release, not the `undefined` in scope when
      // the toggle was called.
      expect(h.spies.newAppElicitationSession).toHaveBeenCalled();
    });

    it("carries the OAuth session id onto both the client and its stores", () => {
      const h = harness({ servers: [entry("a")] });

      const client = h.published()!(entry("a"), "auth-1");

      expect(client.getSessionId()).toBe("auth-1");
      expect(h.spies.createStores).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ sessionId: "auth-1" }),
      );
    });

    it("adds the install CIMD metadata URL even with no per-server OAuth", () => {
      const h = harness({
        servers: [entry("a")],
        clientConfig: {
          cimd: { enabled: true, clientMetadataUrl: "https://cimd.example/m" },
        },
      });

      expect(() => h.published()!(entry("a"))).not.toThrow();
      expect(h.spies.setInspectorClient).toHaveBeenCalled();
    });

    it("forwards the refresh-token opt-out on its own", () => {
      // The last operand of the "is there any per-server OAuth?" chain, so it
      // is the only shape that reaches it — every other field short-circuits.
      const settings: InspectorServerSettings = {
        ...EMPTY_SETTINGS,
        oauthRequestRefreshToken: false,
      };
      const h = harness({
        servers: [entry("a", { settings })],
        persisted: { a: settings },
      });

      const client = h.published()!(entry("a", { settings }));
      expect(client.getServerSettings()?.oauthRequestRefreshToken).toBe(false);
    });

    it("threads the per-server authorization params and endpoint overrides", () => {
      const settings: InspectorServerSettings = {
        ...EMPTY_SETTINGS,
        oauthAuthorizationParams: [{ key: "audience", value: "api" }],
        oauthAuthorizationUrl: "https://as.example/authorize",
        oauthTokenUrl: "https://as.example/token",
      };
      const h = harness({
        servers: [entry("a", { settings })],
        persisted: { a: settings },
      });

      const client = h.published()!(entry("a", { settings }));
      expect(client.getServerSettings()).toEqual(settings);
    });
  });

  describe("onToggleConnection", () => {
    it("connects a fresh server and clears the stale failure flags", async () => {
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(h.spies.setActiveServerId).toHaveBeenCalledWith("a");
      expect(h.spies.setFailedServerId).toHaveBeenCalledWith(undefined);
      expect(h.api().connectErrorMessage).toBeUndefined();
    });

    it("does not re-set the active id when the target is already active", async () => {
      const h = harness({ servers: [entry("a")], activeServerId: "a" });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(h.spies.setActiveServerId).not.toHaveBeenCalled();
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it("disconnects when the target is the live session", async () => {
      const h = harness({ servers: [entry("a")] });
      await act(async () => {
        await h.api().onToggleConnection("a");
      });
      const client = lastClient(h);
      h.rerender({
        servers: [entry("a")],
        activeServerId: "a",
        connectionStatus: "connected",
        client,
      });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(disconnectSpy).toHaveBeenCalled();
      expect(h.spies.finalizeExplicitDisconnect).toHaveBeenCalled();
    });

    it("finalizes the disconnect even when the transport close rejects", async () => {
      const h = harness({ servers: [entry("a")] });
      await act(async () => {
        await h.api().onToggleConnection("a");
      });
      const client = lastClient(h);
      h.rerender({
        servers: [entry("a")],
        activeServerId: "a",
        connectionStatus: "connected",
        client,
      });
      disconnectSpy.mockRejectedValueOnce(new Error("close failed"));

      await act(async () => {
        await expect(h.api().onToggleConnection("a")).rejects.toThrow(
          "close failed",
        );
      });

      expect(h.spies.finalizeExplicitDisconnect).toHaveBeenCalled();
    });

    it("is a no-op for an id the catalog does not hold", async () => {
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("missing");
      });

      expect(connectSpy).not.toHaveBeenCalled();
      expect(h.spies.setInspectorClient).not.toHaveBeenCalled();
    });

    it("reports an unconfigured enterprise IdP without flagging the card", async () => {
      connectSpy.mockRejectedValueOnce(
        new EmaClientNotConfiguredError("not_configured"),
      );
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(toastTitles()).toContain('Cannot connect to "Server a"');
      expect(h.spies.setFailedServerId).not.toHaveBeenCalledWith("a");
    });

    it("reports an insecure token endpoint as terminal, without flagging the card", async () => {
      // SEP-2207 (#2280). Asserted on the hook, not just the notice helper,
      // because what makes this arm correct is its *position*: above
      // `setFailedServerId` and above the generic toast. A helper-only test
      // cannot see either of those go wrong.
      connectSpy.mockRejectedValueOnce(
        new InsecureTokenEndpointError(
          "http://tenant.app.localhost:3300/token",
        ),
      );
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(toastTitles()).toContain("Token endpoint is not secure");
      // The generic arm must not also fire — two notifications for one failure
      // is how the raw SDK text would creep back in beside the good copy.
      expect(toastTitles()).not.toContain('Failed to connect to "Server a"');
      expect(h.spies.setFailedServerId).not.toHaveBeenCalledWith("a");
      // The real `connect()` sets status `"error"` and dispatches
      // `statusChange` before rethrowing, which paints the card red and pins
      // the monitoring sidebar open — presenting this as the failed connect
      // attempt the notice says it is not. `connect` is mocked here, so the
      // teardown is what this asserts; without it the client is left in that
      // state.
      expect(disconnectSpy).toHaveBeenCalled();
    });

    it("finds an insecure token endpoint wrapped under `cause` on the connect path", async () => {
      // Era negotiation and the transport wrappers bury the rejection, so the
      // shallow check this replaced would have missed exactly this shape.
      connectSpy.mockRejectedValueOnce(
        new Error("connect failed", {
          cause: new InsecureTokenEndpointError("http://localhost.:8091/token"),
        }),
      );
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(toastTitles()).toContain("Token endpoint is not secure");
      expect(h.spies.setFailedServerId).not.toHaveBeenCalledWith("a");
      expect(disconnectSpy).toHaveBeenCalled();
    });

    it("reports an insecure token endpoint raised by the 401 authorization attempt", async () => {
      // The second of the two arms: `authenticate()` rejects rather than the
      // opening handshake, which is the path a refresh takes.
      connectSpy.mockRejectedValueOnce(unauthorized());
      authenticateSpy.mockRejectedValueOnce(
        new InsecureTokenEndpointError("http://localhost.:8091/token"),
      );
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(toastTitles()).toContain("Token endpoint is not secure");
      expect(toastTitles()).not.toContain(
        'OAuth authorization failed for "Server a"',
      );
      expect(h.spies.setFailedServerId).not.toHaveBeenCalledWith("a");
      // The generic arm also records this as the connect error banner text;
      // the terminal arm returns before that, so it must stay unset.
      expect(h.api().connectErrorMessage).toBeUndefined();
    });

    it("reports a terminal refusal raised by the retried connect, without flagging the card", async () => {
      // The satisfied-challenge retry still ends in a token exchange, so it can
      // raise this on its own. Reporting it as a failed connect is doubly wrong
      // here: the Inspector has just told the user the authorization worked
      // (#2280).
      connectSpy
        .mockRejectedValueOnce(
          new AuthRecoveryRequiredError(
            new URL("https://as.example/authorize"),
            { reason: "unauthorized" },
          ),
        )
        .mockRejectedValueOnce(
          new InsecureTokenEndpointError("http://localhost.:8091/token"),
        );
      checkSpy.mockResolvedValueOnce(true);
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(connectSpy).toHaveBeenCalledTimes(2);
      expect(toastTitles()).toContain("Token endpoint is not secure");
      expect(toastTitles()).not.toContain('Failed to connect to "Server a"');
      expect(h.spies.setFailedServerId).not.toHaveBeenCalledWith("a");
      expect(h.api().connectErrorMessage).toBeUndefined();
      // The teardown the generic arm does is still required on this one.
      expect(disconnectSpy).toHaveBeenCalled();
    });

    it("retries the connect when the auth challenge is already satisfied", async () => {
      connectSpy.mockRejectedValueOnce(
        new AuthRecoveryRequiredError(new URL("https://as.example/authorize"), {
          reason: "unauthorized",
        }),
      );
      checkSpy.mockResolvedValueOnce(true);
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(connectSpy).toHaveBeenCalledTimes(2);
      expect(h.spies.prepareOAuthRedirect).not.toHaveBeenCalled();
    });

    it("redirects when the challenge is unsatisfied", async () => {
      const authorizationUrl = new URL("https://as.example/authorize");
      connectSpy.mockRejectedValueOnce(
        new AuthRecoveryRequiredError(authorizationUrl, {
          reason: "insufficient_scope",
        }),
      );
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(h.spies.prepareOAuthRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: "a",
          authKind: "reauth",
          authorizationUrl,
          preRedirectContext: "connect",
        }),
      );
    });

    it("surfaces a throw from the challenge check as the failed connect it is", async () => {
      connectSpy.mockRejectedValueOnce(
        new AuthRecoveryRequiredError(new URL("https://as.example/authorize"), {
          reason: "unauthorized",
        }),
      );
      checkSpy.mockRejectedValueOnce(new Error("discovery exploded"));
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(h.spies.setFailedServerId).toHaveBeenCalledWith("a");
      expect(h.api().connectErrorMessage).toBe("discovery exploded");
      expect(disconnectSpy).toHaveBeenCalled();
      expect(h.spies.prepareOAuthRedirect).not.toHaveBeenCalled();
      expect(toastTitles()).toContain('Failed to connect to "Server a"');
    });

    it("reconnects when a 401 turns out to need no authorization", async () => {
      connectSpy.mockRejectedValueOnce(unauthorized());
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(authenticateSpy).toHaveBeenCalled();
      expect(connectSpy).toHaveBeenCalledTimes(2);
    });

    it("redirects when a 401 yields an authorization URL", async () => {
      const authUrl = new URL("https://as.example/authorize?x=1");
      connectSpy.mockRejectedValueOnce(unauthorized());
      authenticateSpy.mockResolvedValueOnce(authUrl);
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(h.spies.prepareOAuthRedirect).toHaveBeenCalledWith(
        expect.objectContaining({ authorizationUrl: authUrl }),
      );
    });

    it("reports an unconfigured IdP raised by the 401 authorization attempt", async () => {
      connectSpy.mockRejectedValueOnce(unauthorized());
      authenticateSpy.mockRejectedValueOnce(
        new EmaClientNotConfiguredError("disabled"),
      );
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(toastTitles()).toContain('Cannot connect to "Server a"');
      expect(h.spies.setFailedServerId).not.toHaveBeenCalledWith("a");
    });

    it("flags the card when the 401 authorization attempt fails outright", async () => {
      connectSpy.mockRejectedValueOnce(unauthorized());
      authenticateSpy.mockRejectedValueOnce("registration rejected");
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(h.spies.setFailedServerId).toHaveBeenCalledWith("a");
      expect(h.api().connectErrorMessage).toBe("registration rejected");
      expect(toastTitles()).toContain(
        'OAuth authorization failed for "Server a"',
      );
    });

    it("flags the card on a plain handshake failure", async () => {
      connectSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(h.spies.setFailedServerId).toHaveBeenCalledWith("a");
      expect(h.api().connectErrorMessage).toBe("ECONNREFUSED");
      expect(toastTitles()).toContain('Failed to connect to "Server a"');
    });

    it("stringifies a non-Error challenge-check rejection and survives a failed teardown", async () => {
      connectSpy.mockRejectedValueOnce(
        new AuthRecoveryRequiredError(new URL("https://as.example/authorize"), {
          reason: "unauthorized",
        }),
      );
      checkSpy.mockRejectedValueOnce("discovery blew up");
      // The teardown is best-effort: its rejection must not replace the real
      // cause with a close error.
      disconnectSpy.mockRejectedValueOnce(new Error("close failed"));
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(h.api().connectErrorMessage).toBe("discovery blew up");
    });

    it("reports an Error from the 401 authorization attempt and survives a failed teardown", async () => {
      connectSpy.mockRejectedValueOnce(unauthorized());
      authenticateSpy.mockRejectedValueOnce(new Error("token endpoint 500"));
      disconnectSpy.mockRejectedValueOnce(new Error("close failed"));
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(h.api().connectErrorMessage).toBe("token endpoint 500");
    });

    it("stringifies a non-Error handshake rejection", async () => {
      connectSpy.mockRejectedValueOnce("boom");
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onToggleConnection("a");
      });

      expect(h.api().connectErrorMessage).toBe("boom");
    });
  });

  describe("onDisconnect", () => {
    it("is a no-op with no live client", async () => {
      const h = harness({ servers: [entry("a")] });

      await act(async () => {
        await h.api().onDisconnect();
      });

      expect(disconnectSpy).not.toHaveBeenCalled();
      expect(h.spies.finalizeExplicitDisconnect).not.toHaveBeenCalled();
    });

    it("closes the transport and finalizes the session", async () => {
      const h = harness({ servers: [entry("a")] });
      await act(async () => {
        await h.api().onToggleConnection("a");
      });
      h.rerender({
        servers: [entry("a")],
        activeServerId: "a",
        connectionStatus: "connected",
        client: lastClient(h),
      });

      await act(async () => {
        await h.api().onDisconnect();
      });

      expect(disconnectSpy).toHaveBeenCalled();
      expect(h.spies.finalizeExplicitDisconnect).toHaveBeenCalled();
    });
  });

  describe("the session-end effects", () => {
    it("tracks the connected server and clears it when the session ends", async () => {
      const h = harness({
        servers: [entry("a")],
        activeServerId: "a",
        connectionStatus: "connected",
      });
      await waitFor(() => expect(h.api().connectedServerId).toBe("a"));

      h.rerender({
        servers: [entry("a")],
        activeServerId: "a",
        connectionStatus: "disconnected",
      });
      await waitFor(() => expect(h.api().connectedServerId).toBeUndefined());
    });

    it("resets the session-scoped UI state on the client's disconnect event", async () => {
      const h = harness({ servers: [entry("a")] });
      await act(async () => {
        await h.api().onToggleConnection("a");
      });
      const client = lastClient(h);
      h.rerender({
        servers: [entry("a")],
        activeServerId: "a",
        connectionStatus: "connected",
        client,
      });

      act(() => {
        client.dispatchEvent(new CustomEvent("disconnect"));
      });

      expect(h.spies.setActiveServerId).toHaveBeenCalledWith(undefined);
      expect(h.spies.closeConnectionInfoModal).toHaveBeenCalled();
      expect(h.spies.clearResultPanels).toHaveBeenCalled();
      expect(h.spies.resetTabUiState).toHaveBeenCalled();
      expect(h.spies.resetTaskProgress).toHaveBeenCalled();
      expect(h.spies.resetLogLevels).toHaveBeenCalled();
      expect(h.spies.resetOAuthRecoveryState).toHaveBeenCalled();
    });

    it("closes the outgoing client's transport when it is replaced", async () => {
      const h = harness({ servers: [entry("a")] });
      await act(async () => {
        await h.api().onToggleConnection("a");
      });
      const first = lastClient(h);
      h.rerender({ servers: [entry("a")], client: first });
      disconnectSpy.mockClear();

      h.rerender({ servers: [entry("a")], client: null });

      await waitFor(() => expect(disconnectSpy).toHaveBeenCalled());
    });
  });

  describe("the deep-link auto-connect", () => {
    it("does nothing without a deep link", async () => {
      const h = harness({ servers: [] });
      await waitFor(() => expect(h.spies.addServer).not.toHaveBeenCalled());
    });

    it("stands down on the OAuth callback path", async () => {
      window.history.replaceState({}, "", "/oauth/callback?code=x");
      const h = harness({ servers: [], deepLink: deepLink() });
      await waitFor(() => expect(h.spies.addServer).not.toHaveBeenCalled());
    });

    it("adds the row, then updates it, then connects — one phase per render", async () => {
      const link = deepLink();
      const h = harness({ servers: [], deepLink: link });

      await waitFor(() =>
        expect(h.spies.addServer).toHaveBeenCalledWith(
          DEEP_LINK_SERVER_ID,
          deepLinkConfig,
        ),
      );

      // The row hydrates carrying a stale transport from an earlier load.
      const stale = entry(DEEP_LINK_SERVER_ID, {
        config: { type: "streamable-http", url: "https://old.example/mcp" },
      });
      h.rerender({ servers: [stale], deepLink: link });
      await waitFor(() =>
        expect(h.spies.updateServer).toHaveBeenCalledWith(
          DEEP_LINK_SERVER_ID,
          DEEP_LINK_SERVER_ID,
          deepLinkConfig,
        ),
      );

      const fresh = entry(DEEP_LINK_SERVER_ID, { config: deepLinkConfig });
      h.rerender({ servers: [fresh], deepLink: link });
      await waitFor(() => expect(connectSpy).toHaveBeenCalled());
    });

    it("swallows the already-exists race and still connects", async () => {
      const link = deepLink();
      const addServerImpl = vi
        .fn()
        .mockRejectedValue(new Error('Server "deep-link" already exists'));
      const h = harness({ servers: [], deepLink: link, addServerImpl });

      await waitFor(() => expect(addServerImpl).toHaveBeenCalled());
      expect(h.api().connectErrorMessage).toBeUndefined();

      // A 409 means the row is already on disk, so hydration surfaces it on a
      // later render and the connect phase must still run. Asserting only that
      // nothing was recorded would stay green for a deep link that swallows the
      // error and then stops forever.
      const fresh = entry(DEEP_LINK_SERVER_ID, { config: deepLinkConfig });
      h.rerender({ servers: [fresh], deepLink: link, addServerImpl });
      await waitFor(() => expect(connectSpy).toHaveBeenCalled());
      expect(h.api().connectErrorMessage).toBeUndefined();
    });

    it("records any other add failure on the machine-readable surface", async () => {
      const addServerImpl = vi
        .fn()
        .mockRejectedValue(new Error("catalog is read-only"));
      const h = harness({ servers: [], deepLink: deepLink(), addServerImpl });

      await waitFor(() =>
        expect(h.api().connectErrorMessage).toBe("catalog is read-only"),
      );
    });

    it("records an update failure", async () => {
      const link = deepLink();
      const updateServerImpl = vi.fn().mockRejectedValue("backend 500");
      const stale = entry(DEEP_LINK_SERVER_ID, {
        config: { type: "streamable-http", url: "https://old.example/mcp" },
      });
      const h = harness({
        servers: [stale],
        deepLink: link,
        updateServerImpl,
      });

      await waitFor(() =>
        expect(h.api().connectErrorMessage).toBe("backend 500"),
      );
    });

    it("does not toggle a session that is already connected to the deep link", async () => {
      const fresh = entry(DEEP_LINK_SERVER_ID, { config: deepLinkConfig });
      const h = harness({
        servers: [fresh],
        deepLink: deepLink(),
        activeServerId: DEEP_LINK_SERVER_ID,
        connectionStatus: "connected",
      });

      await waitFor(() => expect(h.api().connectedServerId).toBe("deep-link"));
      expect(connectSpy).not.toHaveBeenCalled();
    });

    it("stringifies a non-Error add failure", async () => {
      const addServerImpl = vi.fn().mockRejectedValue("catalog exploded");
      const h = harness({ servers: [], deepLink: deepLink(), addServerImpl });

      await waitFor(() =>
        expect(h.api().connectErrorMessage).toBe("catalog exploded"),
      );
    });

    it("records an Error update failure by message", async () => {
      const updateServerImpl = vi
        .fn()
        .mockRejectedValue(new Error("read-only catalog"));
      const stale = entry(DEEP_LINK_SERVER_ID, {
        config: { type: "streamable-http", url: "https://old.example/mcp" },
      });
      const h = harness({
        servers: [stale],
        deepLink: deepLink(),
        updateServerImpl,
      });

      await waitFor(() =>
        expect(h.api().connectErrorMessage).toBe("read-only catalog"),
      );
    });

    it("records a rejection that escapes the connect toggle", async () => {
      // Client construction runs outside the toggle's try/catch, so a throw
      // there escapes `onToggleConnection` altogether rather than being
      // toasted inside it — the case this catch exists for.
      const fresh = entry(DEEP_LINK_SERVER_ID, { config: deepLinkConfig });
      const h = harness({ servers: [fresh], deepLink: deepLink() });
      h.spies.destroyStores.mockImplementationOnce(() => {
        throw new Error("teardown wedged");
      });

      await waitFor(() =>
        expect(h.api().connectErrorMessage).toBe("teardown wedged"),
      );
    });
  });

  describe("onReauthenticateFromBanner", () => {
    it("does nothing with no banner raised", () => {
      const h = harness({ servers: [entry("a")] });
      act(() => h.api().onReauthenticateFromBanner());
      expect(h.spies.setReAuthBanner).not.toHaveBeenCalled();
    });

    it("clears the stale OAuth state before reconnecting on lost state", async () => {
      const h = harness({
        servers: [entry("a")],
        reAuthBanner: {
          serverId: "a",
          message: "lost",
          kind: "lost_authorization_state",
        },
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      expect(h.spies.setReAuthBanner).toHaveBeenCalledWith(null);
      await waitFor(() => expect(clearServerOAuthStateMock).toHaveBeenCalled());
      await waitFor(() => expect(connectSpy).toHaveBeenCalled());
    });

    it("abandons the lost-state recovery when the clear fails", async () => {
      clearServerOAuthStateMock.mockRejectedValueOnce(new Error("storage 500"));
      const h = harness({
        servers: [entry("a")],
        reAuthBanner: {
          serverId: "a",
          message: "lost",
          kind: "lost_authorization_state",
        },
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      await waitFor(() =>
        expect(toastTitles()).toContain(
          "Could not clear the stored authorization state",
        ),
      );
      expect(connectSpy).not.toHaveBeenCalled();
    });

    it("hands the live client to the clear when the banner names the active server", async () => {
      const h = harness({ servers: [entry("a")] });
      await act(async () => {
        await h.api().onToggleConnection("a");
      });
      const client = lastClient(h);
      h.rerender({
        servers: [entry("a")],
        activeServerId: "a",
        connectionStatus: "connected",
        client,
        reAuthBanner: {
          serverId: "a",
          message: "lost",
          kind: "lost_authorization_state",
        },
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      await waitFor(() =>
        expect(clearServerOAuthStateMock).toHaveBeenCalledWith(
          expect.objectContaining({
            inspectorClient: client,
            isActiveConnection: true,
          }),
        ),
      );
    });

    it("stringifies a non-Error clear failure", async () => {
      clearServerOAuthStateMock.mockRejectedValueOnce("storage unreachable");
      const h = harness({
        servers: [entry("a")],
        reAuthBanner: {
          serverId: "a",
          message: "lost",
          kind: "lost_authorization_state",
        },
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      await waitFor(() =>
        expect(
          notificationsMock.show.mock.calls.some(
            (c) => c[0]?.message === "storage unreachable",
          ),
        ).toBe(true),
      );
    });

    it("reconnects directly when the lost-state server is gone from the catalog", async () => {
      const h = harness({
        servers: [],
        reAuthBanner: {
          serverId: "ghost",
          message: "lost",
          kind: "lost_authorization_state",
        },
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      expect(clearServerOAuthStateMock).not.toHaveBeenCalled();
      // No catalog row, so the toggle finds no target and stands down.
      expect(connectSpy).not.toHaveBeenCalled();
    });

    it("re-authorizes in place when the session is still connected", async () => {
      const h = harness({ servers: [entry("a")] });
      await act(async () => {
        await h.api().onToggleConnection("a");
      });
      const client = lastClient(h);
      h.rerender({
        servers: [entry("a")],
        activeServerId: "a",
        connectionStatus: "connected",
        client,
        reAuthBanner: { serverId: "a", message: "lapsed" },
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      await waitFor(() => expect(pushAuthSpy).toHaveBeenCalled());
      expect(toastTitles()).toContain("Authorization restored");
    });

    it("redirects when the in-place re-authorization needs the browser", async () => {
      const authUrl = new URL("https://as.example/authorize?y=2");
      authenticateSpy.mockResolvedValue(authUrl);
      const h = harness({ servers: [entry("a")] });
      await act(async () => {
        await h.api().onToggleConnection("a");
      });
      const client = lastClient(h);
      h.rerender({
        servers: [entry("a")],
        activeServerId: "a",
        connectionStatus: "connected",
        client,
        reAuthBanner: { serverId: "a", message: "lapsed" },
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      await waitFor(() =>
        expect(h.spies.prepareOAuthRedirect).toHaveBeenCalledWith(
          expect.objectContaining({ serverId: "a", authorizationUrl: authUrl }),
        ),
      );
    });

    it("names the server when the in-place re-authorization fails", async () => {
      const h = harness({ servers: [entry("a")] });
      await act(async () => {
        await h.api().onToggleConnection("a");
      });
      const client = lastClient(h);
      authenticateSpy.mockRejectedValue(new Error("token endpoint 500"));
      h.rerender({
        servers: [entry("a")],
        activeServerId: "a",
        connectionStatus: "connected",
        client,
        reAuthBanner: { serverId: "a", message: "lapsed" },
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      await waitFor(() =>
        expect(toastTitles()).toContain(
          'OAuth authorization failed for "Server a"',
        ),
      );
    });

    it("reports a terminal token-endpoint refusal from the banner action", async () => {
      // The path a user reaches by *acting*: an ordinary re-auth banner, they
      // click Re-authenticate, and the exchange is refused. The worst place to
      // fall back to the raw SDK text, since they have just been told that
      // retrying is the fix (#2280).
      const h = harness({ servers: [entry("a")] });
      await act(async () => {
        await h.api().onToggleConnection("a");
      });
      const client = lastClient(h);
      authenticateSpy.mockRejectedValue(
        new InsecureTokenEndpointError("http://localhost.:8091/token"),
      );
      h.rerender({
        servers: [entry("a")],
        activeServerId: "a",
        connectionStatus: "connected",
        client,
        reAuthBanner: { serverId: "a", message: "lapsed" },
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      await waitFor(() =>
        expect(toastTitles()).toContain("Token endpoint is not secure"),
      );
      expect(toastTitles()).not.toContain(
        'OAuth authorization failed for "Server a"',
      );
    });

    it("falls back to an unnamed failure toast for an unknown server", async () => {
      const h = harness({ servers: [entry("a")] });
      await act(async () => {
        await h.api().onToggleConnection("a");
      });
      const client = lastClient(h);
      authenticateSpy.mockRejectedValue("nope");
      // The banner names a server the current list no longer carries, while
      // the *session* is still the connected one — the in-place arm runs but
      // has no entry to name.
      h.rerender({
        servers: [entry("ghost")],
        activeServerId: "ghost",
        connectionStatus: "connected",
        client,
        reAuthBanner: { serverId: "ghost", message: "lapsed" },
      });
      h.rerender({
        servers: [],
        activeServerId: "ghost",
        connectionStatus: "connected",
        client,
        reAuthBanner: { serverId: "ghost", message: "lapsed" },
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      await waitFor(() =>
        expect(toastTitles()).toContain("OAuth authorization failed"),
      );
    });

    it("records a construction throw instead of leaving it unhandled", async () => {
      // Client construction runs ahead of the toggle's try/catch, so a throw
      // there escapes `onToggleConnection`. Both banner call sites discard the
      // promise, so without `retryConnect` this is an unhandled rejection with
      // the banner already dismissed and nothing left to explain it.
      const h = harness({
        servers: [entry("a"), entry("b")],
        activeServerId: "a",
        connectionStatus: "connected",
        reAuthBanner: { serverId: "b", message: "lapsed" },
      });
      h.spies.destroyStores.mockImplementationOnce(() => {
        throw new Error("teardown wedged");
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      await waitFor(() =>
        expect(h.api().connectErrorMessage).toBe("teardown wedged"),
      );
    });

    it("records a construction throw on the lost-state retry too", async () => {
      const h = harness({
        servers: [entry("a")],
        reAuthBanner: {
          serverId: "a",
          message: "lost",
          kind: "lost_authorization_state",
        },
      });
      h.spies.destroyStores.mockImplementationOnce(() => {
        throw "teardown wedged";
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      await waitFor(() =>
        expect(h.api().connectErrorMessage).toBe("teardown wedged"),
      );
    });

    it("toggles the connection when the banner's server is not the live one", async () => {
      const h = harness({
        servers: [entry("a"), entry("b")],
        activeServerId: "a",
        connectionStatus: "connected",
        reAuthBanner: { serverId: "b", message: "lapsed" },
      });

      await act(async () => {
        h.api().onReauthenticateFromBanner();
      });

      await waitFor(() => expect(connectSpy).toHaveBeenCalled());
    });
  });
});
