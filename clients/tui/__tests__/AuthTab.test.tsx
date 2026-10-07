import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "./helpers/renderTui";
import type { OAuthConnectionState } from "@inspector/core/auth/types.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";

vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { AuthTab } from "../src/components/AuthTab.js";
import { buildOsc52Sequence } from "../src/utils/clipboard.js";

const tick = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};

const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

const sampleOAuthState: OAuthConnectionState = {
  authorized: true,
  protocol: "standard",
  serverUrl: "http://x/mcp",
  client: {
    clientId: "abc123",
    registrationKind: "dcr",
    hasClientSecret: false,
  },
  tokens: {
    access_token: "tok-abcdefghijklmnopqrstuvwxyz",
    token_type: "Bearer",
  },
  authorizationServerMetadata: {
    issuer: "https://auth.example.com",
    authorization_endpoint: "https://auth.example.com/authorize",
    token_endpoint: "https://auth.example.com/token",
    response_types_supported: ["code"],
  },
  configuredScope: "read write",
};

function makeClient(oauthState?: OAuthConnectionState) {
  const listeners = new Map<string, Set<() => void>>();
  const getOAuthState = vi.fn(async () => oauthState);
  const client = {
    getOAuthState,
    addEventListener: (event: string, fn: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    removeEventListener: (event: string, fn: () => void) => {
      listeners.get(event)?.delete(fn);
    },
  };
  const fire = (event: string) => {
    listeners.get(event)?.forEach((fn) => fn());
  };
  return {
    client: client as unknown as InspectorClient,
    getOAuthState,
    fire,
    listeners,
  };
}

const baseProps = {
  serverName: "srv" as string | null,
  serverConfig: null,
  width: 120,
  height: 30,
  oauthRevision: 0,
  onClearOAuth: vi.fn(),
  connectionStatus: "disconnected" as const,
};

const pendingStepUp = {
  challenge: {
    reason: "insufficient_scope" as const,
    requiredScopes: ["env:read"],
    authorizationScopes: ["tools:read", "env:read"],
  },
  enterpriseManaged: true,
};

describe("AuthTab", () => {
  it("renders the placeholder when there is no server", () => {
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        serverName={null}
        inspectorClient={null}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    expect(lastFrame() ?? "").toContain(
      "Select a server to view authentication",
    );
  });

  // #2144 — the clear is now a bounded network request, so announcing "cleared"
  // on the keypress would say it while the work was still in flight.
  it("shows a pending state until the clear settles, and ignores repeats", async () => {
    let settle: () => void = () => {};
    const onClearOAuth = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const { lastFrame, stdin } = render(
      <AuthTab
        {...baseProps}
        onClearOAuth={onClearOAuth}
        inspectorClient={null}
        oauthStatus="idle"
        oauthMessage={null}
        focused
      />,
    );
    await tick();

    stdin.write("s");
    await tick();
    expect(lastFrame() ?? "").toContain("Clearing OAuth state");
    expect(lastFrame() ?? "").not.toContain("OAuth state cleared");

    // A second press while one is in flight would race the first over the same
    // store entry, and nothing on screen tells the user the first is running.
    stdin.write("s");
    await tick();
    expect(onClearOAuth).toHaveBeenCalledTimes(1);

    settle();
    await tick();
    expect(lastFrame() ?? "").toContain("OAuth state cleared");
  });

  // A state-based guard is not effective until React re-renders, so two `s`
  // events in the SAME input turn both read the last-rendered "idle" and start
  // concurrent clears against one store entry. No tick between the writes.
  it("ignores a repeat delivered in the same input turn", async () => {
    const onClearOAuth = vi.fn(() => new Promise<void>(() => {}));
    const { stdin } = render(
      <AuthTab
        {...baseProps}
        onClearOAuth={onClearOAuth}
        inspectorClient={null}
        oauthStatus="idle"
        oauthMessage={null}
        focused
      />,
    );
    await tick();

    stdin.write("s");
    stdin.write("s");
    await tick();

    expect(onClearOAuth).toHaveBeenCalledTimes(1);
  });

  // A rejection releases the lock, so the user can retry.
  it("allows a retry after a rejected clear", async () => {
    const onClearOAuth = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("nope"))
      .mockResolvedValue(undefined);
    const { stdin } = render(
      <AuthTab
        {...baseProps}
        onClearOAuth={onClearOAuth}
        inspectorClient={null}
        oauthStatus="idle"
        oauthMessage={null}
        focused
      />,
    );
    await tick();
    stdin.write("s");
    await tick();
    stdin.write("s");
    await tick();

    expect(onClearOAuth).toHaveBeenCalledTimes(2);
  });

  // A stale completion owns nothing: server A settling after the user moved to
  // B and started a clear there must not drop B's lock, or a second B clear
  // could run concurrently against the same store entry.
  it("a stale completion does not release the current server's lock", async () => {
    const settlers: Array<() => void> = [];
    const onClearOAuth = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settlers.push(resolve);
        }),
    );
    const props = (serverName: string) => ({
      ...baseProps,
      serverName,
      onClearOAuth,
      inspectorClient: null,
      oauthStatus: "idle" as const,
      oauthMessage: null,
      focused: true,
    });
    const { stdin, rerender } = render(<AuthTab {...props("a")} />);
    await tick();

    stdin.write("s"); // A's clear starts
    await tick();
    rerender(<AuthTab {...props("b")} />);
    await tick();
    stdin.write("s"); // B's clear starts
    await tick();
    expect(onClearOAuth).toHaveBeenCalledTimes(2);

    // A settles late. B's clear is still running, so its lock must hold.
    settlers[0]!();
    await tick();
    stdin.write("s");
    await tick();

    expect(onClearOAuth).toHaveBeenCalledTimes(2);
  });

  // A rejection is NOT a revocation failure — those come back as outcomes and
  // are reported through the message line. This is the local clear or the
  // disconnect itself failing, so reporting success would be a plain lie.
  it("reports a rejected clear as a failure, not as success", async () => {
    const onClearOAuth = vi.fn(() =>
      Promise.reject(new Error("keychain locked")),
    );
    const { lastFrame, stdin } = render(
      <AuthTab
        {...baseProps}
        onClearOAuth={onClearOAuth}
        inspectorClient={null}
        oauthStatus="idle"
        oauthMessage={null}
        focused
      />,
    );
    await tick();
    stdin.write("s");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Could not clear OAuth state");
    expect(frame).toContain("keychain locked");
    expect(frame).not.toContain("OAuth state cleared.");
    expect(frame).not.toContain("Clearing OAuth state");
  });

  // A clear started on server A must not confirm under server B: it is a
  // bounded network request now, so it can settle after the user has moved on.
  it("does not confirm a clear that settles after the server changed", async () => {
    let settle: () => void = () => {};
    const onClearOAuth = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const { lastFrame, stdin, rerender } = render(
      <AuthTab
        {...baseProps}
        serverName="a"
        onClearOAuth={onClearOAuth}
        inspectorClient={null}
        oauthStatus="idle"
        oauthMessage={null}
        focused
      />,
    );
    await tick();
    stdin.write("s");
    await tick();
    expect(lastFrame() ?? "").toContain("Clearing OAuth state");

    rerender(
      <AuthTab
        {...baseProps}
        serverName="b"
        onClearOAuth={onClearOAuth}
        inspectorClient={null}
        oauthStatus="idle"
        oauthMessage={null}
        focused
      />,
    );
    await tick();
    settle();
    await tick();

    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("OAuth state cleared");
    expect(frame).not.toContain("Clearing OAuth state");
  });

  // #2144 — a revocation failure is a *partial* success: the local state really
  // was cleared, so it is not an `error` status, but the grant may still be
  // live at the authorization server and the informational tone understates
  // that. Both tones are exercised so neither branch can rot.
  it("renders an idle message in the warning tone when asked", () => {
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        inspectorClient={null}
        oauthStatus="idle"
        oauthMessage="Cleared locally, but revoking failed."
        oauthMessageTone="warning"
      />,
    );
    expect(lastFrame() ?? "").toContain("Cleared locally");
  });

  it("renders an idle message in the default informational tone", () => {
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        inspectorClient={null}
        oauthStatus="idle"
        oauthMessage="Stored OAuth state cleared."
      />,
    );
    expect(lastFrame() ?? "").toContain("Stored OAuth state cleared.");
  });

  it("renders OAuth details from getOAuthState", async () => {
    const { client } = makeClient(sampleOAuthState);
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("OAuth Details");
    expect(frame).toContain("Authorized");
    expect(frame).toContain("abc123");
    expect(frame).toContain("Dynamic (DCR)");
    expect(frame).toContain("read, write");
    expect(frame).toContain("tok-abcdefghijklmnopqrst");
  });

  it("shows the not-yet-authorized hint when getOAuthState is empty", async () => {
    const { client } = makeClient(undefined);
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No OAuth information yet");
    expect(frame).toContain("Connect (C) to authorize");
  });

  it("renders authenticating and error status messages", async () => {
    const { client } = makeClient(undefined);
    const { lastFrame, rerender } = render(
      <AuthTab
        {...baseProps}
        inspectorClient={client}
        oauthStatus="authenticating"
        oauthMessage={null}
      />,
    );
    expect(lastFrame() ?? "").toContain("Authenticating");

    // A note raised mid-flow stays visible while authenticating (#2533).
    rerender(
      <AuthTab
        {...baseProps}
        inspectorClient={client}
        oauthStatus="authenticating"
        oauthMessage="Open it by hand"
        oauthMessageTone="warning"
      />,
    );
    expect(lastFrame() ?? "").toContain("Authenticating");
    expect(lastFrame() ?? "").toContain("Open it by hand");
    rerender(
      <AuthTab
        {...baseProps}
        inspectorClient={client}
        oauthStatus="authenticating"
        oauthMessage="Re-authenticating"
      />,
    );
    expect(lastFrame() ?? "").toContain("Re-authenticating");

    rerender(
      <AuthTab
        {...baseProps}
        inspectorClient={client}
        oauthStatus="error"
        oauthMessage="Something went wrong"
      />,
    );
    expect(lastFrame() ?? "").toContain("Something went wrong");
  });

  it("clears OAuth state on S and shows confirmation", async () => {
    const onClearOAuth = vi.fn();
    const { client } = makeClient(sampleOAuthState);
    const { lastFrame, stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        onClearOAuth={onClearOAuth}
      />,
    );
    stdin.write("s");
    await tick();
    expect(onClearOAuth).toHaveBeenCalled();
    expect(lastFrame() ?? "").toContain("OAuth state cleared");
  });

  it("shows clear+disconnect label when connected", async () => {
    const { client } = makeClient(sampleOAuthState);
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        focused
        connectionStatus="connected"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    await tick();
    expect(lastFrame() ?? "").toContain("clear+disconnect");
  });

  it("shows the focused footer when focused", async () => {
    const { client } = makeClient(sampleOAuthState);
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        focused
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    await tick();
    expect(lastFrame() ?? "").toContain("S clear");
  });

  it("scrolls with arrow and page keys when focused", async () => {
    const { client } = makeClient(sampleOAuthState);
    const { lastFrame, stdin } = render(
      <AuthTab
        {...baseProps}
        height={80}
        focused
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    await tick();
    stdin.write(UP);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();
    expect(lastFrame() ?? "").toContain("OAuth Details");
  });

  it("navigates step-up choices with arrows and activates with Enter", async () => {
    const onAuthorizeStepUp = vi.fn();
    const onCancelStepUp = vi.fn();
    const { client } = makeClient(sampleOAuthState);
    const { stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        pendingStepUp={pendingStepUp}
        onAuthorizeStepUp={onAuthorizeStepUp}
        onCancelStepUp={onCancelStepUp}
      />,
    );
    await tick();
    stdin.write("\r");
    await tick();
    expect(onAuthorizeStepUp).toHaveBeenCalledTimes(1);
    expect(onCancelStepUp).not.toHaveBeenCalled();

    onAuthorizeStepUp.mockClear();
    stdin.write(DOWN);
    await tick();
    stdin.write("\r");
    await tick();
    expect(onCancelStepUp).toHaveBeenCalledTimes(1);
    expect(onAuthorizeStepUp).not.toHaveBeenCalled();
  });

  it("shows step-up footer with selection hints when focused", async () => {
    const { client } = makeClient(sampleOAuthState);
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        focused
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        pendingStepUp={pendingStepUp}
        onAuthorizeStepUp={vi.fn()}
        onCancelStepUp={vi.fn()}
      />,
    );
    await tick();
    expect(lastFrame() ?? "").toContain("↑/↓ select, Enter confirm");
  });

  it("refreshes OAuth state when connection becomes connected", async () => {
    const { client, getOAuthState } = makeClient(undefined);
    const { lastFrame, rerender } = render(
      <AuthTab
        {...baseProps}
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        connectionStatus="disconnected"
      />,
    );
    await tick();
    expect(getOAuthState).toHaveBeenCalledTimes(1);
    expect(lastFrame() ?? "").toContain("No OAuth information yet");

    getOAuthState.mockResolvedValue(sampleOAuthState);
    rerender(
      <AuthTab
        {...baseProps}
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        connectionStatus="connected"
      />,
    );
    await tick();
    expect(getOAuthState).toHaveBeenCalledTimes(2);
    expect(lastFrame() ?? "").toContain("Authorized");
    expect(lastFrame() ?? "").toContain("OAuth Details");
  });

  it("moves the step-up selection back up with the up arrow", async () => {
    const onAuthorizeStepUp = vi.fn();
    const onCancelStepUp = vi.fn();
    const { client } = makeClient(sampleOAuthState);
    const { stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        pendingStepUp={pendingStepUp}
        onAuthorizeStepUp={onAuthorizeStepUp}
        onCancelStepUp={onCancelStepUp}
      />,
    );
    await tick();
    // Move down to "cancel" (index 1), then back up to "authorize" (index 0).
    stdin.write(DOWN);
    await tick();
    stdin.write(UP);
    await tick();
    stdin.write("\r");
    await tick();
    expect(onAuthorizeStepUp).toHaveBeenCalledTimes(1);
    expect(onCancelStepUp).not.toHaveBeenCalled();
  });

  it("authorizes step-up with 'a', cancels with 'c', and ignores other keys", async () => {
    const onAuthorizeStepUp = vi.fn();
    const onCancelStepUp = vi.fn();
    const { client } = makeClient(sampleOAuthState);
    const { stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        pendingStepUp={pendingStepUp}
        onAuthorizeStepUp={onAuthorizeStepUp}
        onCancelStepUp={onCancelStepUp}
      />,
    );
    await tick();
    stdin.write("a");
    await tick();
    expect(onAuthorizeStepUp).toHaveBeenCalledTimes(1);

    stdin.write("c");
    await tick();
    expect(onCancelStepUp).toHaveBeenCalledTimes(1);

    // An unrelated key is swallowed while the step-up prompt is pending.
    stdin.write("x");
    await tick();
    expect(onAuthorizeStepUp).toHaveBeenCalledTimes(1);
    expect(onCancelStepUp).toHaveBeenCalledTimes(1);
  });

  it("refreshes OAuth state when oauthComplete fires", async () => {
    const { client, getOAuthState, fire, listeners } =
      makeClient(sampleOAuthState);
    const { unmount } = render(
      <AuthTab
        {...baseProps}
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    await tick();
    expect(getOAuthState).toHaveBeenCalled();
    expect(listeners.get("oauthComplete")?.size).toBe(1);
    getOAuthState.mockClear();
    fire("oauthComplete");
    await tick();
    expect(getOAuthState).toHaveBeenCalled();
    unmount();
    expect(listeners.get("oauthComplete")?.size).toBe(0);
  });

  it("Y copies the full access token via OSC 52 (#2421)", async () => {
    const { client } = makeClient(sampleOAuthState);
    const { stdin, stdout, lastFrame } = render(
      <AuthTab
        {...baseProps}
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        focused
      />,
    );
    await tick();
    expect(lastFrame()).toContain("Y copy token, W save token");
    stdin.write("Y");
    await tick();
    expect(stdout.frames).toContain(
      buildOsc52Sequence("tok-abcdefghijklmnopqrstuvwxyz"),
    );
    expect(lastFrame()).toContain("Copied access token (30 chars)");
  });

  it("offers no token copy when there is no access token", async () => {
    const { client } = makeClient(undefined);
    const { stdin, stdout, lastFrame } = render(
      <AuthTab
        {...baseProps}
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        focused
      />,
    );
    await tick();
    expect(lastFrame()).not.toContain("Y copy token");
    stdin.write("y");
    await tick();
    expect(stdout.frames.some((f) => f.includes("\u001b]52;"))).toBe(false);
  });

  describe("server switch (#2421)", () => {
    const withToken = (token: string): OAuthConnectionState => ({
      ...sampleOAuthState,
      tokens: { access_token: token, token_type: "Bearer" },
    });
    /** A client whose getOAuthState resolves only when the test says so. */
    function deferredClient() {
      let resolve: (s: OAuthConnectionState) => void = () => {};
      const pending = new Promise<OAuthConnectionState>((r) => {
        resolve = r;
      });
      const client = {
        getOAuthState: vi.fn(() => pending),
        addEventListener: () => {},
        removeEventListener: () => {},
        // Double cast: a partial test double covering only the three members
        // AuthTab calls, same as makeClient above; InspectorClient is a class
        // with private state, so no structural single cast can reach it.
      } as unknown as InspectorClient;
      return { client, resolve };
    }
    const tab = (client: InspectorClient, serverName: string) => (
      <AuthTab
        {...baseProps}
        serverName={serverName}
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        focused
      />
    );

    it("does not show or copy the previous server's token while the next one loads", async () => {
      const a = makeClient(withToken("token-for-server-A-xxxxxxxx"));
      const b = deferredClient();
      const { stdin, stdout, lastFrame, rerender } = render(tab(a.client, "A"));
      await tick();
      expect(lastFrame()).toContain("token-for-server-A");

      rerender(tab(b.client, "B"));
      await tick();
      expect(lastFrame()).not.toContain("token-for-server-A");
      stdin.write("y");
      await tick();
      expect(
        stdout.frames.some((f) =>
          f.includes(buildOsc52Sequence("token-for-server-A-xxxxxxxx")),
        ),
      ).toBe(false);

      b.resolve(withToken("token-for-server-B-yyyyyyyy"));
      await tick();
      expect(lastFrame()).toContain("token-for-server-B");
    });

    it("ignores a read that settles after the selection moved on", async () => {
      const a = deferredClient();
      const b = makeClient(withToken("token-for-server-B-yyyyyyyy"));
      const { lastFrame, rerender } = render(tab(a.client, "A"));
      await tick();
      rerender(tab(b.client, "B"));
      await tick();
      expect(lastFrame()).toContain("token-for-server-B");

      a.resolve(withToken("token-for-server-A-xxxxxxxx"));
      await tick();
      expect(lastFrame()).toContain("token-for-server-B");
      expect(lastFrame()).not.toContain("token-for-server-A");
    });
  });
});
