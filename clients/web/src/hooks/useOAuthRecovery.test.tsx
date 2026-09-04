import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AuthorizationServerMismatchError } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import type {
  ConnectionStatus,
  FetchRequestEntry,
  ServerEntry,
} from "@inspector/core/mcp/types.js";
import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import { EmaClientNotConfiguredError } from "@inspector/core/auth/ema/clientConfigError.js";
import { useLayoutEffect, useRef } from "react";
import { renderWithMantine, act, waitFor } from "../test/renderWithMantine";
import {
  OAUTH_RESUME_KEY,
  writeOAuthResumeSnapshot,
  type OAuthResumeSnapshot,
} from "../lib/oauthResume";
import type { StepUpSource } from "../utils/stepUp";
import { EMPTY_SETTINGS } from "../utils/serverSettingsDefaults";
import { useSessionRef } from "./useSessionRef";
import { useTabUiState } from "./useTabUiState";
import {
  revocationSuffix,
  useOAuthRecovery,
  type FetchRequestSource,
  type OAuthRecovery,
  type SetupClientForServer,
} from "./useOAuthRecovery";

// --- Module doubles ---------------------------------------------------------
// Everything the hook reaches outside React: the toast layer, the two storage
// adapters, and the tab-visibility listener. `lib/oauthResume` is deliberately
// NOT mocked — it is a thin sessionStorage round-trip, and driving the real one
// is what proves the snapshot the redirect writes is the snapshot the callback
// reads back.

const { notificationsMock } = vi.hoisted(() => ({
  notificationsMock: { show: vi.fn(), update: vi.fn(), hide: vi.fn() },
}));
vi.mock("@mantine/notifications", () => ({ notifications: notificationsMock }));

const { oauthStorageMock } = vi.hoisted(() => ({
  oauthStorageMock: { load: vi.fn(), clear: vi.fn() },
}));
vi.mock("../lib/remoteOAuthStorage", () => ({
  getWebRemoteOAuthStorage: () => oauthStorageMock,
}));

const { clearServerOAuthStateMock } = vi.hoisted(() => ({
  clearServerOAuthStateMock: vi.fn(),
}));
vi.mock("../lib/clearServerOAuthState", () => ({
  clearServerOAuthState: clearServerOAuthStateMock,
}));

const { saveSessionMock } = vi.hoisted(() => ({ saveSessionMock: vi.fn() }));
vi.mock("@inspector/core/mcp/remote/index.js", () => ({
  RemoteInspectorClientStorage: class {
    saveSession = saveSessionMock;
  },
  // #2144: `clearServerOAuthAndDisconnect` builds the backend-proxied fetch the
  // revocation POST would travel on. Nothing here exercises a real request, so
  // this only has to exist.
  createRemoteFetch: () => remoteFetchMock,
}));

const { remoteFetchMock } = vi.hoisted(() => ({
  remoteFetchMock: vi.fn<typeof fetch>(async () => new Response(null)),
}));

vi.mock("../lib/authToken", () => ({ getAuthToken: () => "test-token" }));

const { visibility } = vi.hoisted(() => ({
  visibility: {
    visible: true,
    listeners: new Set<() => void>(),
  },
}));
vi.mock("../lib/browserTabVisibility", () => ({
  isBrowserTabVisible: () => visibility.visible,
  onBrowserTabVisible: (cb: () => void) => {
    visibility.listeners.add(cb);
    return () => visibility.listeners.delete(cb);
  },
}));

/** Fire the tab-became-visible signal the deferred-recovery path waits on. */
function becomeVisible(): void {
  visibility.visible = true;
  for (const cb of visibility.listeners) cb();
}

// --- Fixtures ---------------------------------------------------------------

const AUTH_URL = new URL("https://as.example/authorize");
/** A 64-char-hex authId, the only `state` shape the callback path accepts. */
const AUTH_ID = "a".repeat(64);

const entry = (
  id: string,
  over: Partial<ServerEntry> = {},
  enterpriseManaged?: boolean,
): ServerEntry => ({
  id,
  name: `Server ${id}`,
  config: { type: "streamable-http", url: "https://mcp.example/mcp" },
  connection: { status: "disconnected" },
  ...(enterpriseManaged !== undefined && {
    settings: { ...EMPTY_SETTINGS, enterpriseManaged },
  }),
  ...over,
});

/** A catalog entry pointing at a different URL, so a different OAuth blob. */
const otherUrlEntry = (id: string): ServerEntry =>
  entry(id, {
    config: { type: "streamable-http", url: "https://other.example/mcp" },
  });

const challenge = (
  reason: AuthChallenge["reason"] = "unauthorized",
): AuthChallenge => ({ reason });

/** One Network-log row, as the pre-redirect flush would find it. */
const fetchEntry = (id: string): FetchRequestEntry => ({
  id,
  timestamp: new Date(0),
  method: "POST",
  url: "https://as.example/token",
  requestHeaders: {},
  category: "auth",
});

/**
 * A stand-in `InspectorClient`.
 *
 * Built on the real prototype (`Object.create`) so the cast is a single one
 * rather than an `as unknown as`: the object genuinely is an `InspectorClient`
 * by prototype, and the assignment below overrides the handful of members the
 * hook calls. The event surface delegates to a real `EventTarget`, since the
 * native one cannot be inherited without running its constructor.
 */
function fakeClient(over: Partial<Record<string, unknown>> = {}) {
  const bus = new EventTarget();
  const client = Object.create(InspectorClient.prototype) as InspectorClient;
  return Object.assign(client, {
    addEventListener: bus.addEventListener.bind(bus),
    removeEventListener: bus.removeEventListener.bind(bus),
    emit: (type: string, detail: unknown) =>
      bus.dispatchEvent(new CustomEvent(type, { detail })),
    getOAuthState: vi.fn().mockResolvedValue(null),
    getRemoteBackendSessionId: vi.fn().mockReturnValue("remote-1"),
    beginInteractiveAuthorization: vi.fn().mockResolvedValue(undefined),
    checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(false),
    pushRemoteAuthState: vi.fn().mockResolvedValue(undefined),
    handleAuthChallenge: vi.fn().mockResolvedValue({ kind: "failed" }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    resumeAfterOAuth: vi.fn().mockResolvedValue(undefined),
    ...over,
  });
}

type FakeClient = ReturnType<typeof fakeClient>;

interface HarnessProps {
  servers?: ServerEntry[];
  activeServerId?: string;
  client?: FakeClient | null;
  connectionStatus?: ConnectionStatus;
  /** Left null to exercise the "connect path not wired yet" callback arm. */
  setupClient?: (server: ServerEntry) => InspectorClient;
  fetchRequests?: FetchRequestEntry[];
  /** Set to drop the Network log entirely, as before the first connect. */
  noFetchLog?: boolean;
}

interface Harness {
  api: () => OAuthRecovery;
  rerender: (next: HarnessProps) => void;
  spies: {
    setActiveServerId: ReturnType<typeof vi.fn>;
    setFailedServerId: ReturnType<typeof vi.fn>;
    clearResultPanels: ReturnType<typeof vi.fn>;
    setSourceScopedError: ReturnType<typeof vi.fn>;
    setupClient: ReturnType<typeof vi.fn>;
  };
}

function harness(initial: HarnessProps = {}): Harness {
  let latest: OAuthRecovery | undefined;
  const spies = {
    setActiveServerId: vi.fn(),
    setFailedServerId: vi.fn(),
    clearResultPanels: vi.fn(),
    setSourceScopedError: vi.fn(),
    setupClient: vi.fn(),
  };

  function Probe({ p }: { p: HarnessProps }) {
    const client = p.client ?? null;
    const sessionRef = useSessionRef({
      activeServerId: p.activeServerId,
      servers: p.servers ?? [],
      inspectorClient: client,
    });
    const { ui, setUi, activeTab, setActiveTab } = useTabUiState();
    const fetchLogRef = useRef<FetchRequestSource | null>(null);
    // Both refs are held across renders and published from a layout effect,
    // exactly as App.tsx does — a fresh object per render would give the
    // callback effect a changing dependency the real one never has, and the
    // deferred-publication test below would then be passing for the wrong
    // reason.
    const setupClientForServerRef = useRef<SetupClientForServer | null>(null);
    useLayoutEffect(() => {
      fetchLogRef.current = p.noFetchLog
        ? null
        : { getFetchRequests: () => p.fetchRequests ?? [] };
      setupClientForServerRef.current = p.setupClient
        ? (server: ServerEntry) => {
            spies.setupClient(server);
            return p.setupClient!(server);
          }
        : null;
    });
    latest = useOAuthRecovery({
      sessionRef,
      servers: p.servers ?? [],
      activeServerId: p.activeServerId,
      inspectorClient: client,
      connectionStatus: p.connectionStatus ?? "connected",
      activeTab,
      ui,
      setUi,
      setActiveTab,
      fetchLogRef,
      connectStartRef: { current: undefined },
      initialConfigSettledRef: { current: { promise: Promise.resolve() } },
      setupClientForServerRef,
      setActiveServerId: spies.setActiveServerId,
      setFailedServerId: spies.setFailedServerId,
      clearResultPanels: spies.clearResultPanels,
      setSourceScopedError: spies.setSourceScopedError,
    });
    return null;
  }

  const { rerender } = renderWithMantine(<Probe p={initial} />);
  return {
    api: () => {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
    rerender: (next) => rerender(<Probe p={next} />),
    spies,
  };
}

/** Every toast title raised so far, for order-insensitive assertions. */
const toastTitles = (): string[] =>
  notificationsMock.show.mock.calls.map((c) => String(c[0]?.title));

const toastWith = (fragment: string) =>
  notificationsMock.show.mock.calls.find((c) =>
    String(c[0]?.message ?? "").includes(fragment),
  );

/** Put the page on `/oauth/callback` with the given query. */
function onCallbackUrl(search: string): void {
  window.history.replaceState({}, "", `/oauth/callback${search}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  visibility.visible = true;
  visibility.listeners.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  oauthStorageMock.load.mockResolvedValue(undefined);
  clearServerOAuthStateMock.mockResolvedValue({ cleared: true });
  saveSessionMock.mockResolvedValue(undefined);
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("useOAuthRecovery", () => {
  describe("pending slots", () => {
    it("mirrors the step-up slot into the session ref and clears it on a server switch", async () => {
      const client = fakeClient();
      const servers = [entry("a"), entry("b")];
      const h = harness({ servers, activeServerId: "a", client });

      await act(async () => {
        await h
          .api()
          .handleCommandScopedAuthRecovery(
            new AuthRecoveryRequiredError(
              AUTH_URL,
              challenge("insufficient_scope"),
            ),
            { serverId: "a", source: "tool" },
          );
      });
      expect(h.api().pendingStepUp?.serverId).toBe("a");

      h.rerender({ servers, activeServerId: "b", client });
      await waitFor(() => expect(h.api().pendingStepUp).toBeNull());
    });

    it("drops a deferred recovery when the user switches server", async () => {
      visibility.visible = false;
      const client = fakeClient();
      const servers = [entry("a"), entry("b")];
      const h = harness({ servers, activeServerId: "a", client });
      await act(async () => {
        client.emit("authChallengeInteractive", {
          challenge: challenge(),
          authorizationUrl: AUTH_URL,
        });
      });
      h.rerender({ servers, activeServerId: "b", client });
      await act(async () => {
        becomeVisible();
      });
      // Cleared rather than resumed against the server the user left.
      expect(client.handleAuthChallenge).not.toHaveBeenCalled();
    });

    it("refuses a second step-up while one is open", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      const raise = () =>
        h
          .api()
          .handleCommandScopedAuthRecovery(
            new AuthRecoveryRequiredError(
              AUTH_URL,
              challenge("insufficient_scope"),
            ),
            { serverId: "a", source: "tool" },
          );

      await act(async () => {
        await raise();
      });
      const first = h.api().pendingStepUp;
      await act(async () => {
        await raise();
      });
      expect(h.api().pendingStepUp).toBe(first);
      expect(toastTitles()).toContain("Step-up authorization in progress");
    });

    it("resets the banner and both slots on a session reset", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        await h
          .api()
          .handleCommandScopedAuthRecovery(
            new AuthRecoveryRequiredError(
              AUTH_URL,
              challenge("insufficient_scope"),
            ),
            { serverId: "a", source: "tool" },
          );
      });
      act(() => h.api().resetOAuthRecoveryState());
      expect(h.api().pendingStepUp).toBeNull();
      expect(h.api().reAuthBanner).toBeNull();
    });
  });

  describe("connection-info OAuth details", () => {
    it("loads details while connected and refreshes on oauthComplete", async () => {
      const client = fakeClient({
        getOAuthState: vi
          .fn()
          .mockResolvedValue({ tokens: { access_token: "t" } }),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await waitFor(() => expect(h.api().connectionInfoOAuth).toBeDefined());
      expect(client.getOAuthState).toHaveBeenCalledTimes(1);

      await act(async () => {
        client.emit("oauthComplete", {});
      });
      await waitFor(() =>
        expect(client.getOAuthState).toHaveBeenCalledTimes(2),
      );
    });

    it("clears the details when the state read comes back empty", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await waitFor(() => expect(client.getOAuthState).toHaveBeenCalled());
      expect(h.api().connectionInfoOAuth).toBeUndefined();
    });

    it("drops a state read that lands after the session ended", async () => {
      let settle: (value: unknown) => void = () => {};
      const client = fakeClient({
        getOAuthState: vi.fn(
          () =>
            new Promise((resolve) => {
              settle = resolve;
            }),
        ),
      });
      const props: HarnessProps = {
        servers: [entry("a")],
        activeServerId: "a",
        client,
      };
      const h = harness(props);
      h.rerender({ ...props, connectionStatus: "disconnected" });
      await act(async () => {
        settle({ tokens: { access_token: "t" } });
      });
      expect(h.api().connectionInfoOAuth).toBeUndefined();
    });

    it("stays undefined while disconnected", async () => {
      const client = fakeClient();
      const h = harness({
        servers: [entry("a")],
        activeServerId: "a",
        client,
        connectionStatus: "disconnected",
      });
      expect(h.api().connectionInfoOAuth).toBeUndefined();
      expect(client.getOAuthState).not.toHaveBeenCalled();
    });

    it("toasts an ambient refresh, naming the active server", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await waitFor(() => expect(client.getOAuthState).toHaveBeenCalled());
      await act(async () => {
        client.emit("authChallengeAmbient", {});
      });
      expect(toastTitles()).toContain(
        'Refreshing authorization for "Server a"',
      );
      h.rerender({ servers: [], activeServerId: undefined, client });
    });

    it("falls back to the unnamed ambient copy with no active server", async () => {
      const client = fakeClient();
      harness({ servers: [], activeServerId: undefined, client });
      await waitFor(() => expect(client.getOAuthState).toHaveBeenCalled());
      await act(async () => {
        client.emit("authChallengeAmbient", {});
      });
      expect(toastTitles()).toContain("Refreshing authorization");
    });
  });

  describe("onBeforeOAuthRedirect", () => {
    it("saves the pre-redirect fetch log under the authorization state's authId", () => {
      const entries = [fetchEntry("f1")];
      const h = harness({ fetchRequests: entries });
      const url = new URL(`https://as.example/authorize?state=${AUTH_ID}`);
      act(() => h.api().onBeforeOAuthRedirect(url));
      expect(saveSessionMock).toHaveBeenCalledWith(
        AUTH_ID,
        expect.objectContaining({ fetchRequests: entries }),
      );
    });

    it("does nothing without a parseable state parameter", () => {
      const h = harness({ fetchRequests: [fetchEntry("f1")] });
      act(() => h.api().onBeforeOAuthRedirect(new URL(AUTH_URL)));
      act(() =>
        h
          .api()
          .onBeforeOAuthRedirect(
            new URL("https://as.example/authorize?state=nope"),
          ),
      );
      expect(saveSessionMock).not.toHaveBeenCalled();
    });

    it("does nothing when the log is empty", () => {
      const h = harness({ fetchRequests: [] });
      act(() =>
        h
          .api()
          .onBeforeOAuthRedirect(
            new URL(`https://as.example/authorize?state=${AUTH_ID}`),
          ),
      );
      expect(saveSessionMock).not.toHaveBeenCalled();
    });

    it("does nothing before the Network log exists", () => {
      const h = harness({ noFetchLog: true });
      act(() =>
        h
          .api()
          .onBeforeOAuthRedirect(
            new URL(`https://as.example/authorize?state=${AUTH_ID}`),
          ),
      );
      expect(saveSessionMock).not.toHaveBeenCalled();
    });

    it("swallows a failed save", async () => {
      saveSessionMock.mockRejectedValue(new Error("offline"));
      const h = harness({ fetchRequests: [fetchEntry("f1")] });
      act(() =>
        h
          .api()
          .onBeforeOAuthRedirect(
            new URL(`https://as.example/authorize?state=${AUTH_ID}`),
          ),
      );
      await waitFor(() => expect(saveSessionMock).toHaveBeenCalled());
    });
  });

  describe("prepareOAuthRedirect", () => {
    it("writes the resume snapshot and starts the authorization", () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      act(() =>
        h.api().prepareOAuthRedirect({
          serverId: "a",
          authKind: "reauth",
          authorizationUrl: AUTH_URL,
          recoverySource: "tool",
        }),
      );
      const raw = window.sessionStorage.getItem(OAUTH_RESUME_KEY);
      expect(raw).toBeTruthy();
      const snapshot = JSON.parse(String(raw)) as OAuthResumeSnapshot;
      expect(snapshot).toMatchObject({
        serverId: "a",
        authKind: "reauth",
        remoteSessionId: "remote-1",
        recoverySource: "tool",
      });
      expect(client.beginInteractiveAuthorization).toHaveBeenCalledWith(
        AUTH_URL,
      );
    });

    it("carries the step-up challenge and prefers an explicitly passed client", () => {
      const active = fakeClient();
      const explicit = fakeClient();
      const h = harness({
        servers: [entry("a")],
        activeServerId: "a",
        client: active,
      });
      const stepUpChallenge = challenge("insufficient_scope");
      act(() =>
        h.api().prepareOAuthRedirect({
          serverId: "a",
          authKind: "step_up",
          authorizationUrl: AUTH_URL,
          authChallenge: stepUpChallenge,
          client: explicit,
          preRedirectContext: "connect",
        }),
      );
      const snapshot = JSON.parse(
        String(window.sessionStorage.getItem(OAUTH_RESUME_KEY)),
      ) as OAuthResumeSnapshot;
      expect(snapshot.authChallenge).toMatchObject({
        reason: "insufficient_scope",
      });
      expect(explicit.beginInteractiveAuthorization).toHaveBeenCalled();
      expect(active.beginInteractiveAuthorization).not.toHaveBeenCalled();
    });

    it("clears the snapshot and reports a redirect that never started", async () => {
      // The navigation is what the snapshot describes, so a rejection here
      // must not leave one behind: the next load would read it as an
      // *abandoned* redirect and offer that (wrong) diagnosis (#2165).
      const client = fakeClient({
        beginInteractiveAuthorization: vi
          .fn()
          .mockRejectedValue(new Error("provider state unreadable")),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        h.api().prepareOAuthRedirect({
          serverId: "a",
          authKind: "reauth",
          authorizationUrl: AUTH_URL,
        });
      });
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
      expect(h.api().reAuthBanner?.message).toContain(
        "provider state unreadable",
      );
      expect(h.spies.setFailedServerId).toHaveBeenCalledWith("a");
      expect(window.sessionStorage.getItem(OAUTH_RESUME_KEY)).toBeNull();
    });

    it("ends a failed connect-scoped attempt instead of leaving it spinning", async () => {
      // `connect()` rejecting with an auth-recovery error holds the status at
      // "connecting"; the redirect was what would have ended that attempt, so
      // if it never happens nothing else does (#2165).
      const client = fakeClient({
        beginInteractiveAuthorization: vi
          .fn()
          .mockRejectedValue(new Error("provider state unreadable")),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        h.api().prepareOAuthRedirect({
          serverId: "a",
          authKind: "reauth",
          authorizationUrl: AUTH_URL,
          preRedirectContext: "connect",
        });
      });
      await waitFor(() => expect(client.disconnect).toHaveBeenCalled());
      expect(h.spies.setFailedServerId).toHaveBeenCalledWith("a");
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
    });

    it("leaves a non-connect attempt's session alone", async () => {
      const client = fakeClient({
        beginInteractiveAuthorization: vi
          .fn()
          .mockRejectedValue(new Error("provider state unreadable")),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        h.api().prepareOAuthRedirect({
          serverId: "a",
          authKind: "step_up",
          authorizationUrl: AUTH_URL,
        });
      });
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it("tolerates having no client at all", () => {
      const h = harness({ servers: [entry("a")], client: null });
      act(() =>
        h.api().prepareOAuthRedirect({
          serverId: "a",
          authKind: "reauth",
          authorizationUrl: AUTH_URL,
        }),
      );
      expect(window.sessionStorage.getItem(OAUTH_RESUME_KEY)).toBeTruthy();
    });
  });

  describe("command-scoped recovery", () => {
    const recoveryError = (reason: AuthChallenge["reason"] = "unauthorized") =>
      new AuthRecoveryRequiredError(AUTH_URL, challenge(reason));

    it("returns false with no live client", async () => {
      const h = harness({ servers: [entry("a")], client: null });
      await act(async () => {
        await expect(
          h.api().handleCommandScopedAuthRecovery(recoveryError(), {
            serverId: "a",
            source: "tool",
          }),
        ).resolves.toBe(false);
      });
    });

    it("reports a stored token that already satisfies the challenge", async () => {
      const client = fakeClient({
        checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(true),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        await expect(
          h.api().handleCommandScopedAuthRecovery(recoveryError(), {
            serverId: "a",
            source: "tool",
          }),
        ).resolves.toBe(true);
      });
      expect(client.pushRemoteAuthState).toHaveBeenCalled();
      expect(toastTitles()).toContain("Authorization restored");
    });

    it("short-circuits an EMA step-up whose scopes are already stored", async () => {
      const client = fakeClient({
        checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(true),
      });
      const h = harness({
        servers: [entry("a", {}, true)],
        activeServerId: "a",
        client,
      });
      await act(async () => {
        await expect(
          h.api().handleCommandScopedAuthRecovery(
            new AuthRecoveryRequiredError(AUTH_URL, challenge("unauthorized"), {
              emaStepUpConfirm: true,
            }),
            { serverId: "a", source: "tool" },
          ),
        ).resolves.toBe(true);
      });
      expect(h.api().pendingStepUp).toBeNull();
    });

    it("redirects for a plain re-auth challenge", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        await expect(
          h.api().handleCommandScopedAuthRecovery(recoveryError(), {
            serverId: "a",
            source: "prompt",
          }),
        ).resolves.toBe(false);
      });
      expect(client.beginInteractiveAuthorization).toHaveBeenCalled();
    });

    it("runs an operation unchanged when there is no session to recover", async () => {
      const h = harness({ servers: [entry("a")], client: null });
      const op = vi.fn().mockResolvedValue("value");
      await act(async () => {
        await expect(
          h.api().runWithCommandAuthRecovery(op, "tool"),
        ).resolves.toBe("value");
      });
      expect(op).toHaveBeenCalledTimes(1);
    });

    it("retries the operation once recovery is satisfied", async () => {
      const client = fakeClient({
        checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(true),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      const op = vi
        .fn()
        .mockRejectedValueOnce(recoveryError())
        .mockResolvedValue("second");
      await act(async () => {
        await expect(
          h.api().runWithCommandAuthRecovery(op, "tool"),
        ).resolves.toBe("second");
      });
      expect(op).toHaveBeenCalledTimes(2);
    });

    it("gives up quietly when recovery is not satisfied", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      const op = vi.fn().mockRejectedValue(recoveryError());
      await act(async () => {
        await expect(
          h.api().runWithCommandAuthRecovery(op, "tool"),
        ).resolves.toBeUndefined();
      });
      expect(op).toHaveBeenCalledTimes(1);
    });

    it("rethrows anything that is not an auth-recovery error", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        await expect(
          h
            .api()
            .runWithCommandAuthRecovery(
              () => Promise.reject(new Error("boom")),
              "tool",
            ),
        ).rejects.toThrow("boom");
      });
    });

    it("toasts a background failure only when given a title", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        h.api().runCommandInBackground(
          () => Promise.reject(new Error("boom")),
          "ambient",
          "Refresh failed",
        );
        await Promise.resolve();
      });
      await waitFor(() => expect(toastTitles()).toContain("Refresh failed"));

      notificationsMock.show.mockClear();
      await act(async () => {
        h.api().runCommandInBackground(
          () => Promise.reject("plain string"),
          "ambient",
        );
        await Promise.resolve();
      });
      expect(notificationsMock.show).not.toHaveBeenCalled();
    });

    it("stringifies a non-Error background failure into the toast", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        h.api().runCommandInBackground(
          () => Promise.reject("plain string"),
          "ambient",
          "Refresh failed",
        );
        await Promise.resolve();
      });
      await waitFor(() => expect(toastWith("plain string")).toBeDefined());
    });
  });

  describe("ambient challenges", () => {
    it("defers recovery while the tab is hidden, then resumes when it returns", async () => {
      visibility.visible = false;
      const client = fakeClient({
        checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(true),
      });
      harness({ servers: [entry("a")], activeServerId: "a", client });

      await act(async () => {
        client.emit("authChallengeInteractive", {
          challenge: challenge(),
          authorizationUrl: AUTH_URL,
        });
      });
      expect(toastTitles()).toContain("Authorization pending");

      await act(async () => {
        becomeVisible();
      });
      await waitFor(() =>
        expect(client.checkAuthChallengeSatisfied).toHaveBeenCalled(),
      );
      expect(toastTitles()).toContain("Authorization restored");
    });

    it("warns when a second deferral replaces the first", async () => {
      visibility.visible = false;
      const client = fakeClient();
      harness({ servers: [entry("a")], activeServerId: "a", client });
      const fire = () =>
        client.emit("authChallengeInteractive", {
          challenge: challenge(),
          authorizationUrl: AUTH_URL,
        });
      await act(async () => {
        fire();
      });
      await act(async () => {
        fire();
      });
      expect(toastTitles()).toContain("Authorization update pending");
    });

    it("ignores an ambient challenge with no active server", async () => {
      const client = fakeClient();
      harness({ servers: [], activeServerId: undefined, client });
      await act(async () => {
        client.emit("authChallengeInteractive", {
          challenge: challenge(),
          authorizationUrl: AUTH_URL,
        });
      });
      expect(client.checkAuthChallengeSatisfied).not.toHaveBeenCalled();
    });

    it("redirects immediately for a visible ambient challenge", async () => {
      const client = fakeClient();
      harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        client.emit("authChallengeInteractive", {
          challenge: challenge(),
          authorizationUrl: AUTH_URL,
        });
      });
      await waitFor(() =>
        expect(client.beginInteractiveAuthorization).toHaveBeenCalled(),
      );
    });

    it("opens the step-up prompt instead of redirecting for a scope challenge", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        client.emit("authChallengeInteractive", {
          challenge: challenge("insufficient_scope"),
          authorizationUrl: AUTH_URL,
        });
      });
      await waitFor(() => expect(h.api().pendingStepUp).not.toBeNull());
      expect(client.beginInteractiveAuthorization).not.toHaveBeenCalled();
    });

    it("does nothing when the stored token already satisfies it", async () => {
      const client = fakeClient({
        checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(true),
      });
      harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        client.emit("authChallengeInteractive", {
          challenge: challenge(),
          authorizationUrl: AUTH_URL,
        });
      });
      await waitFor(() =>
        expect(toastTitles()).toContain("Authorization restored"),
      );
      expect(client.beginInteractiveAuthorization).not.toHaveBeenCalled();
    });

    it("reports a challenge whose recovery check rejects", async () => {
      // A listener cannot be awaited, so without the handler's own catch this
      // challenge draws no UI response whatsoever (#2165).
      const client = fakeClient({
        checkAuthChallengeSatisfied: vi
          .fn()
          .mockRejectedValue(new Error("remote auth state unreachable")),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        client.emit("authChallengeInteractive", {
          challenge: challenge(),
          authorizationUrl: AUTH_URL,
        });
      });
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
      expect(h.api().reAuthBanner?.message).toContain(
        "remote auth state unreachable",
      );
      expect(h.spies.setFailedServerId).toHaveBeenCalledWith("a");
      expect(client.beginInteractiveAuthorization).not.toHaveBeenCalled();
    });

    it("reports a rejected challenge against the server it arrived for", async () => {
      // The catch must not re-read the active server: a switch during the
      // await would otherwise flag the wrong one, or drop the report (#2165).
      let rejectCheck: ((err: Error) => void) | undefined;
      const client = fakeClient({
        checkAuthChallengeSatisfied: vi.fn(
          () =>
            new Promise((_resolve, reject) => {
              rejectCheck = reject;
            }),
        ),
      });
      const servers = [entry("a"), entry("b")];
      const h = harness({ servers, activeServerId: "a", client });
      await act(async () => {
        client.emit("authChallengeInteractive", {
          challenge: challenge(),
          authorizationUrl: AUTH_URL,
        });
      });
      await waitFor(() => expect(rejectCheck).toBeDefined());

      h.rerender({ servers, activeServerId: "b", client });
      await act(async () => {
        rejectCheck!(new Error("remote auth state unreachable"));
      });

      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
      expect(h.spies.setFailedServerId).toHaveBeenCalledWith("a");
      expect(h.spies.setFailedServerId).not.toHaveBeenCalledWith("b");
    });

    it("raises the banner on an oauthError event", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        client.emit("oauthError", { error: new Error("token endpoint 500") });
      });
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
    });

    it("ignores an oauthError with no active server", async () => {
      const client = fakeClient();
      const h = harness({ servers: [], activeServerId: undefined, client });
      await act(async () => {
        client.emit("oauthError", { error: new Error("nope") });
      });
      expect(h.api().reAuthBanner).toBeNull();
    });
  });

  describe("resuming a deferred recovery", () => {
    const defer = async (client: FakeClient, h: Harness) => {
      visibility.visible = false;
      await act(async () => {
        client.emit("authChallengeInteractive", {
          challenge: challenge(),
          authorizationUrl: AUTH_URL,
        });
      });
      expect(h.api()).toBeDefined();
    };

    it("re-runs the challenge and reports a satisfied outcome", async () => {
      const client = fakeClient({
        handleAuthChallenge: vi.fn().mockResolvedValue({ kind: "satisfied" }),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await defer(client, h);
      await act(async () => {
        becomeVisible();
      });
      await waitFor(() =>
        expect(client.handleAuthChallenge).toHaveBeenCalled(),
      );
      expect(toastTitles()).toContain("Authorization restored");
    });

    it("redirects on an interactive outcome", async () => {
      const client = fakeClient({
        handleAuthChallenge: vi.fn().mockResolvedValue({
          kind: "interactive",
          challenge: challenge(),
          authorizationUrl: AUTH_URL,
        }),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await defer(client, h);
      await act(async () => {
        becomeVisible();
      });
      await waitFor(() =>
        expect(client.beginInteractiveAuthorization).toHaveBeenCalled(),
      );
    });

    it("raises the banner on a failed outcome", async () => {
      const client = fakeClient({
        handleAuthChallenge: vi
          .fn()
          .mockResolvedValue({ kind: "failed", error: new Error("nope") }),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await defer(client, h);
      await act(async () => {
        becomeVisible();
      });
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
    });

    it("goes back through the step-up prompt when that is what was deferred", async () => {
      const client = fakeClient();
      const h = harness({
        servers: [entry("a")],
        activeServerId: "a",
        client,
      });
      visibility.visible = false;
      await act(async () => {
        client.emit("authChallengeInteractive", {
          challenge: challenge("insufficient_scope"),
          authorizationUrl: AUTH_URL,
        });
      });
      await act(async () => {
        becomeVisible();
      });
      await waitFor(() => expect(h.api().pendingStepUp).not.toBeNull());
      expect(client.handleAuthChallenge).not.toHaveBeenCalled();
    });

    it("does nothing when the tab returns with nothing deferred", async () => {
      const client = fakeClient();
      harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        becomeVisible();
      });
      expect(client.handleAuthChallenge).not.toHaveBeenCalled();
    });

    it("does nothing once the client is gone", async () => {
      const client = fakeClient({
        handleAuthChallenge: vi.fn().mockResolvedValue({ kind: "satisfied" }),
      });
      const props: HarnessProps = {
        servers: [entry("a")],
        activeServerId: "a",
        client,
      };
      const h = harness(props);
      await defer(client, h);
      h.rerender({ ...props, client: null });
      await act(async () => {
        becomeVisible();
      });
      expect(client.handleAuthChallenge).not.toHaveBeenCalled();
    });

    it("runs one resume at a time", async () => {
      const client = fakeClient({
        handleAuthChallenge: vi.fn().mockResolvedValue({ kind: "satisfied" }),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await defer(client, h);
      // Both fire before the first resume's `await` settles, so the second one
      // still sees the deferred slot in the session ref — which is exactly the
      // re-entrancy `reauthResumeInProgressRef` exists to stop.
      await act(async () => {
        becomeVisible();
        becomeVisible();
      });
      expect(client.handleAuthChallenge).toHaveBeenCalledTimes(1);
    });

    it("restores the deferred slot when the resume itself rejects", async () => {
      // The slot is cleared to keep two triggers from racing, not because the
      // recovery was delivered — so a rejection has to put it back rather than
      // dropping the deferred recovery silently (#2165).
      const client = fakeClient({
        handleAuthChallenge: vi
          .fn()
          .mockRejectedValue(new Error("token endpoint unreachable")),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await defer(client, h);

      await act(async () => {
        becomeVisible();
      });
      await waitFor(() =>
        expect(client.handleAuthChallenge).toHaveBeenCalledTimes(1),
      );
      expect(toastTitles()).toContain("Could not continue authorization");
      expect(toastWith("token endpoint unreachable")).toBeTruthy();

      // Restored, so the next trigger retries it.
      await act(async () => {
        becomeVisible();
      });
      await waitFor(() =>
        expect(client.handleAuthChallenge).toHaveBeenCalledTimes(2),
      );
    });

    it("does not put a stale challenge back over a newer deferral", async () => {
      // The tab can go hidden mid-resume and a newer challenge defer itself
      // into the slot; that one describes the session as it is now, so the
      // failing attempt must not overwrite it (#2165).
      let rejectResume: ((err: Error) => void) | undefined;
      const client = fakeClient({
        handleAuthChallenge: vi.fn(
          () =>
            new Promise((_resolve, reject) => {
              rejectResume = reject;
            }),
        ),
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await defer(client, h);

      await act(async () => {
        becomeVisible();
      });
      await waitFor(() => expect(rejectResume).toBeDefined());

      // A newer challenge arrives while the resume is still in flight.
      visibility.visible = false;
      await act(async () => {
        client.emit("authChallengeInteractive", {
          challenge: challenge("insufficient_scope"),
          authorizationUrl: AUTH_URL,
        });
      });

      await act(async () => {
        rejectResume!(new Error("token endpoint unreachable"));
      });
      await waitFor(() =>
        expect(toastTitles()).toContain("Could not continue authorization"),
      );

      // The newer (step-up) challenge is what the next trigger acts on.
      await act(async () => {
        becomeVisible();
      });
      await waitFor(() => expect(h.api().pendingStepUp).not.toBeNull());
      expect(client.handleAuthChallenge).toHaveBeenCalledTimes(1);
    });

    it("does not resurrect a challenge whose session ended mid-resume", async () => {
      // A server switch clears the slot on purpose. The in-flight attempt then
      // rejects, finds it empty, and must NOT put its own challenge back — it
      // belongs to a session that has ended (#2165).
      let rejectResume: ((err: Error) => void) | undefined;
      const client = fakeClient({
        handleAuthChallenge: vi.fn(
          () =>
            new Promise((_resolve, reject) => {
              rejectResume = reject;
            }),
        ),
      });
      const servers = [entry("a"), entry("b")];
      const h = harness({ servers, activeServerId: "a", client });
      await defer(client, h);

      await act(async () => {
        becomeVisible();
      });
      await waitFor(() => expect(rejectResume).toBeDefined());

      h.rerender({ servers, activeServerId: "b", client });
      await act(async () => {
        rejectResume!(new Error("token endpoint unreachable"));
      });
      await waitFor(() =>
        expect(toastTitles()).toContain("Could not continue authorization"),
      );

      // …and says so, rather than promising a retry it will not make.
      expect(toastWith("the session it belonged to has ended")).toBeTruthy();
      expect(toastWith("will try again")).toBeUndefined();

      // Nothing was restored, so returning to the tab resumes nothing.
      await act(async () => {
        becomeVisible();
      });
      expect(client.handleAuthChallenge).toHaveBeenCalledTimes(1);
    });

    it("does not resume while disconnected, and resumes on the reconnect", async () => {
      const client = fakeClient({
        handleAuthChallenge: vi.fn().mockResolvedValue({ kind: "satisfied" }),
      });
      const props: HarnessProps = {
        servers: [entry("a")],
        activeServerId: "a",
        client,
      };
      const h = harness(props);
      await defer(client, h);

      h.rerender({ ...props, connectionStatus: "disconnected" });
      await act(async () => {
        becomeVisible();
      });
      expect(client.handleAuthChallenge).not.toHaveBeenCalled();

      h.rerender({ ...props, connectionStatus: "connected" });
      await waitFor(() =>
        expect(client.handleAuthChallenge).toHaveBeenCalled(),
      );
    });
  });

  describe("abandoned redirect", () => {
    it("raises the banner for an abandoned re-auth", async () => {
      writeOAuthResumeSnapshot({
        version: 1,
        serverId: "a",
        activeTab: "tools",
        authKind: "reauth",
        tabUi: {},
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a" });
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
      expect(window.sessionStorage.getItem(OAUTH_RESUME_KEY)).toBeNull();
    });

    it("raises the banner for an abandoned step-up", async () => {
      writeOAuthResumeSnapshot({
        version: 1,
        serverId: "a",
        activeTab: "tools",
        authKind: "step_up",
        tabUi: {},
        recoverySource: "tool",
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a" });
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
    });

    it("does nothing without a snapshot, or before the list hydrates", async () => {
      const h = harness({ servers: [] });
      await waitFor(() => expect(h.api().reAuthBanner).toBeNull());
      h.rerender({ servers: [entry("a")] });
      await waitFor(() => expect(h.api().reAuthBanner).toBeNull());
    });

    it("checks once per load", async () => {
      writeOAuthResumeSnapshot({
        version: 1,
        serverId: "a",
        activeTab: "tools",
        authKind: "reauth",
        tabUi: {},
      });
      const h = harness({ servers: [entry("a")], activeServerId: "a" });
      await waitFor(() => expect(h.api().reAuthBanner).not.toBeNull());
      act(() => h.api().setReAuthBanner(null));
      h.rerender({ servers: [entry("a"), entry("b")], activeServerId: "a" });
      await waitFor(() => expect(h.api().reAuthBanner).toBeNull());
    });

    it("skips the check on the callback path", async () => {
      onCallbackUrl("");
      writeOAuthResumeSnapshot({
        version: 1,
        serverId: "a",
        activeTab: "tools",
        authKind: "reauth",
        tabUi: {},
      });
      const h = harness({ servers: [entry("a")] });
      await waitFor(() => expect(h.api().reAuthBanner).toBeNull());
      expect(window.sessionStorage.getItem(OAUTH_RESUME_KEY)).toBeTruthy();
    });
  });

  describe("/oauth/callback", () => {
    const snapshot = (over: Partial<OAuthResumeSnapshot> = {}) =>
      writeOAuthResumeSnapshot({
        version: 1,
        serverId: "a",
        activeTab: "tools",
        authKind: "reauth",
        tabUi: {},
        ...over,
      } as OAuthResumeSnapshot);

    const callbackHarness = (
      search: string,
      over: Partial<HarnessProps> = {},
      client = fakeClient(),
    ) => {
      onCallbackUrl(search);
      return harness({
        servers: [entry("a")],
        setupClient: () => client,
        ...over,
      });
    };

    it("keeps the code unspent when no client builder has been published", async () => {
      onCallbackUrl(`?code=abc&state=${AUTH_ID}`);
      snapshot();
      const client = fakeClient();
      // App.tsx publishes the builder from a layout effect, so this arm is
      // defensive rather than reachable there. What it has to guarantee is
      // that the guard returns *before* the one-shot latch: a run that cannot
      // exchange must not spend the single-use authorization code.
      const h = harness({ servers: [entry("a")] });
      await waitFor(() =>
        expect(window.location.pathname).toBe("/oauth/callback"),
      );
      expect(client.resumeAfterOAuth).not.toHaveBeenCalled();

      // The next `servers` change — the same dependency the hydration wait
      // rides in production — still finds the latch open.
      h.rerender({
        servers: [entry("a"), entry("b")],
        setupClient: () => client,
      });
      await waitFor(() => expect(client.resumeAfterOAuth).toHaveBeenCalled());
    });

    it("exchanges the single-use code exactly once", async () => {
      snapshot();
      const client = fakeClient();
      const h = callbackHarness(`?code=abc&state=${AUTH_ID}`, {}, client);
      await waitFor(() => expect(client.resumeAfterOAuth).toHaveBeenCalled());
      h.rerender({
        servers: [entry("a"), entry("b")],
        setupClient: () => client,
      });
      await waitFor(() => expect(h.spies.setupClient).toHaveBeenCalledTimes(1));
      expect(client.resumeAfterOAuth).toHaveBeenCalledTimes(1);
    });

    it("rejects a state parameter that did not originate here", async () => {
      snapshot();
      const client = fakeClient();
      callbackHarness("?code=abc&state=forged", {}, client);
      await waitFor(() =>
        expect(toastTitles()).toContain("OAuth callback rejected"),
      );
      expect(client.resumeAfterOAuth).not.toHaveBeenCalled();
    });

    it("flags the server and banners a provider error", async () => {
      snapshot();
      const h = callbackHarness("?error=access_denied");
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
      expect(h.spies.setFailedServerId).toHaveBeenCalledWith("a");
    });

    it("toasts a provider error that cannot be matched to a server", async () => {
      callbackHarness("?error=access_denied");
      await waitFor(() =>
        expect(toastTitles()).toContain("OAuth authorization failed"),
      );
    });

    it("toasts a success that cannot be matched to a server", async () => {
      callbackHarness(`?code=abc&state=${AUTH_ID}`);
      await waitFor(() =>
        expect(toastTitles()).toContain("OAuth callback could not be matched"),
      );
    });

    it("flags and banners a client rebuild that throws", async () => {
      // Between the arms that have their own handling (#2165): by the time
      // `setupClientForServer` runs, the callback URL and the one-shot
      // snapshot are both spent, so there is nothing left to retry with.
      snapshot();
      onCallbackUrl(`?code=abc&state=${AUTH_ID}`);
      const h = harness({
        servers: [entry("a")],
        setupClient: () => {
          throw new Error("client construction failed");
        },
      });
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
      expect(h.api().reAuthBanner?.message).toContain(
        "client construction failed",
      );
      expect(h.spies.setFailedServerId).toHaveBeenCalledWith("a");
    });

    it("flags and banners a post-resume scope check that rejects", async () => {
      snapshot({
        authKind: "step_up",
        authChallenge: { reason: "insufficient_scope" },
      });
      const client = fakeClient({
        checkAuthChallengeSatisfied: vi
          .fn()
          .mockRejectedValue(new Error("scope check unreachable")),
      });
      const h = callbackHarness(`?code=abc&state=${AUTH_ID}`, {}, client);
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
      expect(h.api().reAuthBanner?.message).toContain(
        "scope check unreachable",
      );
      expect(h.spies.setFailedServerId).toHaveBeenCalledWith("a");
    });

    it("restores the shell, rebuilds the client and completes", async () => {
      snapshot({ remoteSessionId: "remote-9" });
      const client = fakeClient();
      const h = callbackHarness(`?code=abc&state=${AUTH_ID}`, {}, client);
      await waitFor(() => expect(client.resumeAfterOAuth).toHaveBeenCalled());
      expect(client.resumeAfterOAuth).toHaveBeenCalledWith(
        "abc",
        expect.objectContaining({ remoteSessionId: "remote-9" }),
      );
      expect(h.spies.setActiveServerId).toHaveBeenCalledWith("a");
      expect(h.spies.clearResultPanels).toHaveBeenCalled();
      await waitFor(() =>
        expect(toastTitles()).toContain("Authorization complete"),
      );
    });

    it("banners a failure to read the OAuth store", async () => {
      snapshot();
      oauthStorageMock.load.mockRejectedValue(new Error("disk gone"));
      const h = callbackHarness(`?code=abc&state=${AUTH_ID}`);
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
      expect(h.spies.setFailedServerId).toHaveBeenCalledWith("a");
    });

    it("reports an unconfigured enterprise client without flagging the server", async () => {
      snapshot();
      const client = fakeClient({
        resumeAfterOAuth: vi
          .fn()
          .mockRejectedValue(new EmaClientNotConfiguredError("disabled")),
      });
      const h = callbackHarness(`?code=abc&state=${AUTH_ID}`, {}, client);
      await waitFor(() =>
        expect(toastTitles()).toContain('Cannot connect to "Server a"'),
      );
      expect(client.disconnect).toHaveBeenCalled();
      expect(h.spies.setFailedServerId).not.toHaveBeenCalled();
    });

    it("offers one-click recovery when the authorization state was lost", async () => {
      snapshot();
      const client = fakeClient({
        resumeAfterOAuth: vi
          .fn()
          .mockRejectedValue(
            new AuthorizationServerMismatchError(
              "discoveryState was not available on the callback leg",
              "https://as.example",
            ),
          ),
      });
      const h = callbackHarness(`?code=abc&state=${AUTH_ID}`, {}, client);
      await waitFor(() =>
        expect(h.api().reAuthBanner?.kind).toBe("lost_authorization_state"),
      );
      expect(h.api().reAuthBanner?.actionLabel).toBeTruthy();
    });

    it("refuses one-click recovery on a genuine issuer mismatch", async () => {
      snapshot();
      const client = fakeClient({
        resumeAfterOAuth: vi
          .fn()
          .mockRejectedValue(
            new AuthorizationServerMismatchError(
              "https://recorded.example",
              "https://other.example",
            ),
          ),
      });
      const h = callbackHarness(`?code=abc&state=${AUTH_ID}`, {}, client);
      await waitFor(() => expect(notificationsMock.show).toHaveBeenCalled());
      expect(h.api().reAuthBanner).toBeNull();
    });

    it("banners any other exchange failure", async () => {
      snapshot();
      const client = fakeClient({
        resumeAfterOAuth: vi.fn().mockRejectedValue("token endpoint said no"),
      });
      const h = callbackHarness(`?code=abc&state=${AUTH_ID}`, {}, client);
      await waitFor(() => expect(h.api().reAuthBanner?.serverId).toBe("a"));
    });

    it("reports a step-up whose extra scopes were not granted", async () => {
      snapshot({
        authKind: "step_up",
        authChallenge: challenge("insufficient_scope"),
      });
      const client = fakeClient({
        checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(false),
      });
      callbackHarness(`?code=abc&state=${AUTH_ID}`, {}, client);
      await waitFor(() =>
        expect(toastTitles()).toContain("Additional permissions not granted"),
      );
    });

    it("completes a step-up whose extra scopes were granted", async () => {
      snapshot({
        authKind: "step_up",
        authChallenge: challenge("insufficient_scope"),
      });
      const client = fakeClient({
        checkAuthChallengeSatisfied: vi.fn().mockResolvedValue(true),
      });
      callbackHarness(`?code=abc&state=${AUTH_ID}`, {}, client);
      await waitFor(() =>
        expect(toastTitles()).toContain("Authorization complete"),
      );
    });
  });

  // #2144 — only the two outcomes a user can act on are surfaced. A skip
  // describes the status quo, and reporting it would turn a confirmation into a
  // notice about something that did not need to happen.
  describe("revocationSuffix", () => {
    it("announces a successful revocation", () => {
      expect(
        revocationSuffix({
          status: "revoked",
          tokenTypeHint: "refresh_token",
          endpoint: "https://as.example/revoke",
        }),
      ).toContain("revoked at the authorization server");
    });

    it("warns that the grant may still be live after a failure", () => {
      const text = revocationSuffix({ status: "failed", detail: "boom" });
      expect(text).toContain("boom");
      expect(text).toContain("may still be valid");
    });

    it("says nothing for a skip or an absent outcome", () => {
      expect(
        revocationSuffix({ status: "skipped", reason: "no_endpoint" }),
      ).toBe("");
      expect(revocationSuffix(undefined)).toBe("");
    });
  });

  describe("clearing stored OAuth state", () => {
    it("says nothing when there was nothing to clear", async () => {
      clearServerOAuthStateMock.mockResolvedValue({ cleared: false });
      const h = harness({ servers: [entry("a")], activeServerId: "a" });
      await act(async () => {
        await h.api().clearServerOAuthAndDisconnect(entry("a"));
      });
      expect(notificationsMock.show).not.toHaveBeenCalled();
    });

    it("disconnects the active session and resets the shell", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        await h.api().clearServerOAuthAndDisconnect(entry("a"));
      });
      expect(client.disconnect).toHaveBeenCalled();
      expect(
        toastWith("Reconnect to run a fresh authorization flow."),
      ).toBeDefined();
    });

    it("leaves a live session alone when clearing another server", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        // A genuinely unrelated entry: its own URL, so its own OAuth blob.
        await h.api().clearServerOAuthAndDisconnect(otherUrlEntry("b"));
      });
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(
        toastWith('Stored OAuth state was removed for "Server b"'),
      ).toBeDefined();
    });

    // #2217 — OAuth state is keyed by URL, so two catalog entries against the
    // same URL share one blob. Clearing the inactive one destroys the active
    // session's tokens (and revokes its grant), which an id-only check cannot
    // see; the session was left connected on dead credentials with no notice.
    it("disconnects the active session when clearing an entry that shares its URL", async () => {
      const client = fakeClient();
      const h = harness({
        servers: [entry("a"), entry("b")],
        activeServerId: "a",
        client,
      });
      await act(async () => {
        await h.api().clearServerOAuthAndDisconnect(entry("b"));
      });
      expect(client.disconnect).toHaveBeenCalled();
      // The live client owns the clear, so in-memory flow state goes too.
      expect(clearServerOAuthStateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          isActiveConnection: true,
          inspectorClient: client,
        }),
      );
      expect(
        toastWith(
          "authorizes against the same URL, so its stored tokens went too",
        ),
      ).toBeDefined();
    });

    // The same-URL branch still snapshots the session it acted on, so a switch
    // during the in-flight clear must not drag the cleanup onto the new one.
    it("does not disconnect a session switched to during a shared-URL clear", async () => {
      let settle: (r: { cleared: boolean }) => void = () => {};
      clearServerOAuthStateMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            settle = resolve as typeof settle;
          }),
      );
      const client = fakeClient();
      const h = harness({
        servers: [entry("a"), entry("b"), otherUrlEntry("c")],
        activeServerId: "a",
        client,
      });

      let done: Promise<void>;
      await act(async () => {
        done = h.api().clearServerOAuthAndDisconnect(entry("b"));
        await Promise.resolve();
      });

      h.rerender({
        servers: [entry("a"), entry("b"), otherUrlEntry("c")],
        activeServerId: "c",
        client,
      });

      await act(async () => {
        settle({ cleared: true });
        await done;
      });

      expect(client.disconnect).not.toHaveBeenCalled();
    });

    // #2144 — this is the web client's production wiring for revocation.
    // Without asserting the arguments, removing the per-server opt-out or
    // handing it the page-origin fetch would leave every test green.
    it("passes the per-server revoke setting and the proxied fetch", async () => {
      const h = harness({ servers: [entry("a")], activeServerId: "a" });
      await act(async () => {
        await h.api().clearServerOAuthAndDisconnect({
          ...entry("a"),
          settings: { ...EMPTY_SETTINGS, oauthRevokeOnClear: false },
        });
      });
      expect(clearServerOAuthStateMock).toHaveBeenCalledWith(
        expect.objectContaining({ revoke: false, fetchFn: remoteFetchMock }),
      );
    });

    it("defaults to revoking when the server did not opt out", async () => {
      const h = harness({ servers: [entry("a")], activeServerId: "a" });
      await act(async () => {
        await h.api().clearServerOAuthAndDisconnect(entry("a"));
      });
      expect(clearServerOAuthStateMock).toHaveBeenCalledWith(
        expect.objectContaining({ revoke: true }),
      );
    });

    // #2144 — the RFC 7009 leg is a bounded network request, so this callback
    // can stay suspended for seconds. `isActive`/`inspectorClient` are captured
    // before it, so without revalidating, a switch during the wait would
    // disconnect the session the user just moved to and run the session-wide
    // cleanup against it.
    it("does not disconnect a session switched to while a clear is in flight", async () => {
      let settle: (r: { cleared: boolean }) => void = () => {};
      clearServerOAuthStateMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            settle = resolve as typeof settle;
          }),
      );
      const client = fakeClient();
      const h = harness({
        servers: [entry("a"), entry("b")],
        activeServerId: "a",
        client,
      });

      let done: Promise<void>;
      await act(async () => {
        done = h.api().clearServerOAuthAndDisconnect(entry("a"));
        await Promise.resolve();
      });

      // The user switches away while the clear is still running.
      h.rerender({
        servers: [entry("a"), entry("b")],
        activeServerId: "b",
        client,
      });

      await act(async () => {
        settle({ cleared: true });
        await done;
      });

      expect(client.disconnect).not.toHaveBeenCalled();
    });

    // A disconnect/reconnect to the SAME server builds a replacement client, so
    // an id-only check passes again and the old clear would run its
    // session-wide cleanup — including the disconnect — against the new session.
    it("does not disconnect a replacement client for the same server", async () => {
      let settle: (r: { cleared: boolean }) => void = () => {};
      clearServerOAuthStateMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            settle = resolve as typeof settle;
          }),
      );
      const original = fakeClient();
      const h = harness({
        servers: [entry("a")],
        activeServerId: "a",
        client: original,
      });

      let done: Promise<void>;
      await act(async () => {
        done = h.api().clearServerOAuthAndDisconnect(entry("a"));
        await Promise.resolve();
      });

      // Same server, new client — a reconnect while the clear is pending.
      const replacement = fakeClient();
      h.rerender({
        servers: [entry("a")],
        activeServerId: "a",
        client: replacement,
      });

      await act(async () => {
        settle({ cleared: true });
        await done;
      });

      // Neither client is torn down: the replacement is the live session and
      // must not be touched, and the original is already gone — disconnecting
      // it would only drag `finalizeExplicitDisconnect` across the new one.
      expect(original.disconnect).not.toHaveBeenCalled();
      expect(replacement.disconnect).not.toHaveBeenCalled();
    });

    it("clears the resume snapshot on an explicit disconnect", () => {
      writeOAuthResumeSnapshot({
        version: 1,
        serverId: "a",
        activeTab: "tools",
        authKind: "reauth",
        tabUi: {},
      });
      const h = harness({ servers: [entry("a")] });
      act(() => h.api().finalizeExplicitDisconnect());
      expect(window.sessionStorage.getItem(OAUTH_RESUME_KEY)).toBeNull();
    });
  });

  describe("step-up prompt", () => {
    const openStepUp = async (
      h: Harness,
      source: StepUpSource = "tool",
      retryOperation?: () => Promise<unknown>,
    ) => {
      await act(async () => {
        await h
          .api()
          .handleCommandScopedAuthRecovery(
            new AuthRecoveryRequiredError(
              AUTH_URL,
              challenge("insufficient_scope"),
            ),
            { serverId: "a", source, retryOperation },
          );
      });
    };

    it("does nothing with no prompt open", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(client.beginInteractiveAuthorization).not.toHaveBeenCalled();
    });

    it("does nothing once the client is gone", async () => {
      const client = fakeClient();
      const props = { servers: [entry("a")], activeServerId: "a", client };
      const h = harness(props);
      await openStepUp(h);
      h.rerender({ ...props, client: null });
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(client.beginInteractiveAuthorization).not.toHaveBeenCalled();
    });

    it("redirects for a standard step-up", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await openStepUp(h);
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(client.beginInteractiveAuthorization).toHaveBeenCalled();
      expect(h.api().pendingStepUp).toBeNull();
    });

    it("runs the stored retry when an EMA step-up is satisfied in place", async () => {
      const client = fakeClient({
        handleAuthChallenge: vi.fn().mockResolvedValue({ kind: "satisfied" }),
      });
      const h = harness({
        servers: [entry("a", {}, true)],
        activeServerId: "a",
        client,
      });
      const retry = vi.fn().mockResolvedValue(undefined);
      await openStepUp(h, "tool", retry);
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(retry).toHaveBeenCalledTimes(1);
      expect(toastTitles()).toContain("Permissions updated");
    });

    it("completes an EMA step-up with no operation to retry", async () => {
      const client = fakeClient({
        handleAuthChallenge: vi.fn().mockResolvedValue({ kind: "satisfied" }),
      });
      const h = harness({
        servers: [entry("a", {}, true)],
        activeServerId: "a",
        client,
      });
      await openStepUp(h, "ambient");
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(toastTitles()).toContain("Permissions updated");
    });

    it("redirects when an EMA step-up needs the browser", async () => {
      const client = fakeClient({
        handleAuthChallenge: vi.fn().mockResolvedValue({
          kind: "interactive",
          challenge: challenge("insufficient_scope"),
          authorizationUrl: AUTH_URL,
        }),
      });
      const h = harness({
        servers: [entry("a", {}, true)],
        activeServerId: "a",
        client,
      });
      await openStepUp(h);
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(client.beginInteractiveAuthorization).toHaveBeenCalled();
    });

    it("routes an EMA step-up failure back to the panel that asked", async () => {
      const client = fakeClient({
        handleAuthChallenge: vi
          .fn()
          .mockResolvedValue({ kind: "failed", error: new Error("denied") }),
      });
      const h = harness({
        servers: [entry("a", {}, true)],
        activeServerId: "a",
        client,
      });
      await openStepUp(h, "prompt");
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(h.spies.setSourceScopedError).toHaveBeenCalledWith(
        "prompt",
        expect.stringContaining("denied"),
      );
    });

    it("routes an EMA step-up that rejects back to the panel that asked", async () => {
      // `StepUpAuthModal` calls this handler as `void onAuthorize()`, so
      // without the catch the rejection reaches nobody (#2165).
      const client = fakeClient({
        handleAuthChallenge: vi
          .fn()
          .mockRejectedValue(new Error("IdP unreachable")),
      });
      const h = harness({
        servers: [entry("a", {}, true)],
        activeServerId: "a",
        client,
      });
      await openStepUp(h, "prompt");
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(h.spies.setSourceScopedError).toHaveBeenCalledWith(
        "prompt",
        expect.stringContaining("IdP unreachable"),
      );
      expect(toastTitles()).toContain("Organization permissions");
    });

    it("reports a failed retry as the command's failure, not the step-up's", async () => {
      const client = fakeClient({
        handleAuthChallenge: vi.fn().mockResolvedValue({ kind: "satisfied" }),
      });
      const h = harness({
        servers: [entry("a", {}, true)],
        activeServerId: "a",
        client,
      });
      const retry = vi.fn().mockRejectedValue(new Error("tools/call failed"));
      await openStepUp(h, "tool", retry);
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      // The permissions leg succeeded, so this is the retried command's
      // failure and is reported as such.
      expect(toastTitles()).toContain("Permissions updated");
      expect(toastTitles()).toContain("Retry failed");
      expect(h.spies.setSourceScopedError).toHaveBeenCalledWith(
        "tool",
        "tools/call failed",
      );
    });

    it("drops the stored retry when an EMA step-up fails", async () => {
      // The prompt is already dismissed and a later step-up does not overwrite
      // the ref, so a retained operation would be re-run by an unrelated
      // authorization (#2165).
      const handleAuthChallenge = vi
        .fn()
        .mockResolvedValueOnce({ kind: "failed", error: new Error("denied") })
        .mockResolvedValue({ kind: "satisfied" });
      const client = fakeClient({ handleAuthChallenge });
      const h = harness({
        servers: [entry("a", {}, true)],
        activeServerId: "a",
        client,
      });
      const retry = vi.fn().mockResolvedValue(undefined);
      await openStepUp(h, "tool", retry);
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(retry).not.toHaveBeenCalled();

      // A later, unrelated EMA step-up succeeds — and must not re-run it.
      await openStepUp(h, "tool");
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(toastTitles()).toContain("Permissions updated");
      expect(retry).not.toHaveBeenCalled();
    });

    it("drops the stored retry when an EMA step-up rejects", async () => {
      const handleAuthChallenge = vi
        .fn()
        .mockRejectedValueOnce(new Error("IdP unreachable"))
        .mockResolvedValue({ kind: "satisfied" });
      const client = fakeClient({ handleAuthChallenge });
      const h = harness({
        servers: [entry("a", {}, true)],
        activeServerId: "a",
        client,
      });
      const retry = vi.fn().mockResolvedValue(undefined);
      await openStepUp(h, "tool", retry);
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });

      await openStepUp(h, "tool");
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(toastTitles()).toContain("Permissions updated");
      expect(retry).not.toHaveBeenCalled();
    });

    it("drops the stored retry when an EMA step-up hands off to a redirect", async () => {
      // The redirect unloads the page, so the closure cannot survive it
      // anyway — and `prepareOAuthRedirect` returns before the navigation is
      // resolved, so on its failure path a retained operation would be left
      // for a later, unrelated step-up to re-run (#2165).
      const handleAuthChallenge = vi
        .fn()
        .mockResolvedValueOnce({
          kind: "interactive",
          challenge: challenge("insufficient_scope"),
          authorizationUrl: AUTH_URL,
        })
        .mockResolvedValue({ kind: "satisfied" });
      const client = fakeClient({ handleAuthChallenge });
      const h = harness({
        servers: [entry("a", {}, true)],
        activeServerId: "a",
        client,
      });
      const retry = vi.fn().mockResolvedValue(undefined);
      await openStepUp(h, "tool", retry);
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(client.beginInteractiveAuthorization).toHaveBeenCalled();

      await openStepUp(h, "tool");
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(toastTitles()).toContain("Permissions updated");
      expect(retry).not.toHaveBeenCalled();
    });

    it("never touches a retry installed by a newer step-up", async () => {
      // Dismissing the prompt frees the slot, so a newer command can open its
      // own step-up while this authorization is still in flight. Reading the
      // shared ref afterwards would run that newer command under this
      // authorization; clearing it would delete it (#2165).
      let settleFirst: ((outcome: unknown) => void) | undefined;
      const handleAuthChallenge = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              settleFirst = resolve;
            }),
        )
        .mockResolvedValue({ kind: "satisfied" });
      const client = fakeClient({ handleAuthChallenge });
      const h = harness({
        servers: [entry("a", {}, true)],
        activeServerId: "a",
        client,
      });

      const firstRetry = vi.fn().mockResolvedValue(undefined);
      await openStepUp(h, "tool", firstRetry);
      let authorize: Promise<void> | undefined;
      await act(async () => {
        authorize = h.api().handleStepUpAuthorize();
      });
      await waitFor(() => expect(settleFirst).toBeDefined());

      // A newer command opens its own step-up mid-flight.
      const secondRetry = vi.fn().mockResolvedValue(undefined);
      await openStepUp(h, "prompt", secondRetry);

      await act(async () => {
        settleFirst!({ kind: "failed", error: new Error("denied") });
        await authorize;
      });

      // The old attempt reported against its own source and ran nothing.
      expect(h.spies.setSourceScopedError).toHaveBeenCalledWith(
        "tool",
        expect.stringContaining("denied"),
      );
      expect(firstRetry).not.toHaveBeenCalled();
      expect(secondRetry).not.toHaveBeenCalled();

      // …and the newer prompt's retry survived to run on its own authorization.
      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(secondRetry).toHaveBeenCalledTimes(1);
      expect(firstRetry).not.toHaveBeenCalled();
    });

    it("keeps the open prompt's retry when a second step-up is refused", async () => {
      // `trySetPendingStepUp` refuses the second prompt, so the second
      // command's operation must not replace the first's — authorizing the
      // open prompt would otherwise run the command the user was just told
      // could not start (#2165).
      const client = fakeClient({
        handleAuthChallenge: vi.fn().mockResolvedValue({ kind: "satisfied" }),
      });
      const h = harness({
        servers: [entry("a", {}, true)],
        activeServerId: "a",
        client,
      });
      const firstRetry = vi.fn().mockResolvedValue(undefined);
      const refusedRetry = vi.fn().mockResolvedValue(undefined);
      await openStepUp(h, "tool", firstRetry);
      await openStepUp(h, "prompt", refusedRetry);
      expect(toastTitles()).toContain("Step-up authorization in progress");

      await act(async () => {
        await h.api().handleStepUpAuthorize();
      });
      expect(firstRetry).toHaveBeenCalledTimes(1);
      expect(refusedRetry).not.toHaveBeenCalled();
    });

    it("cancels back to the panel that asked", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await openStepUp(h, "resource");
      act(() => h.api().handleStepUpCancel());
      expect(h.spies.setSourceScopedError).toHaveBeenCalledWith(
        "resource",
        "Authorization cancelled.",
      );
      expect(h.api().pendingStepUp).toBeNull();
    });

    it("toasts a cancel that came from an App", async () => {
      const client = fakeClient();
      const h = harness({ servers: [entry("a")], activeServerId: "a", client });
      await openStepUp(h, "app");
      act(() => h.api().handleStepUpCancel());
      expect(toastTitles()).toContain("Authorization cancelled");
    });

    it("is a no-op with no prompt open", () => {
      const h = harness({ servers: [entry("a")], activeServerId: "a" });
      act(() => h.api().handleStepUpCancel());
      expect(h.spies.setSourceScopedError).not.toHaveBeenCalled();
    });
  });
});
