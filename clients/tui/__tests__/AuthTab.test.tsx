import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import type { OAuthConnectionState } from "@inspector/core/auth/types.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";

vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { AuthTab } from "../src/components/AuthTab.js";

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
  },
  tokens: {
    access_token: "tok-abcdefghijklmnopqrstuvwxyz",
    token_type: "Bearer",
  },
  authorizationServerMetadata: {
    authorization_endpoint: "https://auth.example.com/authorize",
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
});
