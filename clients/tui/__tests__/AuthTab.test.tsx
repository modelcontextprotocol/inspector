import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import {
  EMPTY_OAUTH_FLOW_STATE,
  type OAuthFlowState,
} from "@inspector/core/auth/index.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";

// MUST mock ink-scroll-view: the real ScrollView renders a placeholder minimap
// in the non-TTY test env and never mounts its children. This passthrough
// renders children directly and stubs scrollBy/scrollTo/getViewportHeight.
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { AuthTab } from "../src/components/AuthTab.js";

// Ink processes stdin keypresses asynchronously — await this after stdin.write.
const tick = async () => {
  // Flush several macrotask cycles so an effect -> setState -> re-render chain
  // settles before assertions, even on slow/loaded CI (a single tick can race).
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};

const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const LEFT = `${ESC}[D`;
const RIGHT = `${ESC}[C`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

/** Minimal fake InspectorClient that only implements the surface AuthTab uses. */
function makeClient(state?: OAuthFlowState) {
  const listeners = new Map<string, Set<() => void>>();
  const client = {
    getOAuthFlowState: () => state,
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
    fire,
    listeners,
  };
}

const flow = (over: Partial<OAuthFlowState>): OAuthFlowState => ({
  ...EMPTY_OAUTH_FLOW_STATE,
  ...over,
});

// A state at "complete" with every detail field populated so getStepDetails
// returns a non-null value for every step (all rendered as completed).
const completeState = flow({
  execution: "guided",
  oauthStep: "complete",
  resourceMetadata: {
    resource: "https://api.example.com",
  } as OAuthFlowState["resourceMetadata"],
  oauthMetadata: {
    issuer: "https://issuer.example.com",
  } as OAuthFlowState["oauthMetadata"],
  oauthClientInfo: {
    client_id: "abc123",
  } as OAuthFlowState["oauthClientInfo"],
  authorizationUrl: new URL("https://auth.example.com/authorize?x=1"),
  authorizationCode: "code-abcdef1234567890",
  oauthTokens: {
    access_token: "tok-abcdefghijklmnopqrstuvwxyz",
    token_type: "Bearer",
  },
});

const baseProps = {
  serverName: "srv" as string | null,
  serverConfig: null,
  width: 120,
  height: 30,
  isOAuthCapable: true,
  selectedAction: "guided" as "guided" | "quick" | "clear",
  onSelectedActionChange: vi.fn(),
  onQuickAuth: vi.fn(async () => {}),
  onGuidedStart: vi.fn(async () => {}),
  onGuidedAdvance: vi.fn(async () => {}),
  onRunGuidedToCompletion: vi.fn(async () => {}),
  onClearOAuth: vi.fn(),
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
    expect(lastFrame() ?? "").toContain("Select an OAuth-capable server");
  });

  it("renders the placeholder when the server is not OAuth-capable", () => {
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        isOAuthCapable={false}
        inspectorClient={null}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    expect(lastFrame() ?? "").toContain("Select an OAuth-capable server");
  });

  it("renders the guided action bar, hint, and progress (unfocused)", async () => {
    const { client } = makeClient(completeState);
    // tall enough that no step detail is clipped by the fixed-height Box
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        height={80}
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Authentication");
    expect(frame).toContain("uided Auth");
    expect(frame).toContain("uick Auth");
    expect(frame).toContain("Clear OAuth");
    expect(frame).toContain("Press [Space] to advance one step");
    expect(frame).toContain("Press [Enter] to run guided auth to completion");
    expect(frame).toContain("Guided OAuth Flow Progress");
    // every step label, all completed (✓)
    expect(frame).toContain("Metadata Discovery");
    expect(frame).toContain("Client Registration");
    expect(frame).toContain("Preparing Authorization");
    expect(frame).toContain("Request Authorization Code");
    expect(frame).toContain("Token Request");
    expect(frame).toContain("Authentication Complete");
    expect(frame).toContain("✓");
    // completed detail strings from getStepDetails
    expect(frame).toContain("Resource:");
    expect(frame).toContain("OAuth:");
    expect(frame).toContain("Code received:");
    expect(frame).toContain("Exchanging code for tokens...");
    expect(frame).toContain("Tokens: access_token=");
    // no focused footer
    expect(frame).not.toContain("select, G/Q/S or Enter run");
  });

  it("renders an in-progress step (cyan →) and not-started steps (○)", async () => {
    const midState = flow({
      execution: "guided",
      oauthStep: "client_registration",
      oauthClientInfo: {
        client_id: "mid-client",
      } as OAuthFlowState["oauthClientInfo"],
    });
    const { client } = makeClient(midState);
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("(in progress)");
    expect(frame).toContain("→");
    expect(frame).toContain("○");
    // in-progress detail (client_registration → oauthClientInfo JSON)
    expect(frame).toContain("mid-client");
  });

  it("renders the 'authorization URL opened' block when awaiting an auth code", async () => {
    const awaitingState = flow({
      execution: "guided",
      oauthStep: "authorization_code",
      authorizationUrl: new URL("https://auth.example.com/go?code=here"),
    });
    const { client } = makeClient(awaitingState);
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Authorization URL opened in browser");
    expect(frame).toContain("auth.example.com/go");
    expect(frame).toContain("Complete authorization in the browser");
  });

  it("covers metadata details when only the resource metadata is present", async () => {
    const resourceOnly = flow({
      oauthStep: "complete",
      resourceMetadata: {
        resource: "https://only-resource.example.com",
      } as OAuthFlowState["resourceMetadata"],
    });
    const { client } = makeClient(resourceOnly);
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Resource:");
    expect(frame).not.toContain("OAuth: {");
  });

  it("covers metadata details when only the oauth metadata is present", async () => {
    const oauthOnly = flow({
      oauthStep: "complete",
      oauthMetadata: {
        issuer: "https://only-issuer.example.com",
      } as OAuthFlowState["oauthMetadata"],
    });
    const { client } = makeClient(oauthOnly);
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    await tick();
    expect(lastFrame() ?? "").toContain("OAuth:");
  });

  it("renders guided progress with no details when the flow state is empty", () => {
    const { client } = makeClient(flow({}));
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Guided OAuth Flow Progress");
    expect(frame).not.toContain("Resource:");
  });

  it("renders guided progress with no inspector client (no flow state)", () => {
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        selectedAction="guided"
        inspectorClient={null}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Guided OAuth Flow Progress");
    expect(frame).toContain("○");
  });

  it("renders the quick hint and 'Authenticating...' status", () => {
    const { client } = makeClient(flow({ execution: "quick" }));
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        selectedAction="quick"
        inspectorClient={client}
        oauthStatus="authenticating"
        oauthMessage={null}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Press [Enter] to run quick auth");
    expect(frame).toContain("Authenticating...");
  });

  it("renders the quick error message", () => {
    const { client } = makeClient(flow({ execution: "quick" }));
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        selectedAction="quick"
        inspectorClient={client}
        oauthStatus="error"
        oauthMessage="Something went wrong"
      />,
    );
    expect(lastFrame() ?? "").toContain("Something went wrong");
  });

  it("renders quick auth results with client info and tokens", async () => {
    const quickSuccess = flow({
      execution: "quick",
      oauthClientInfo: {
        client_id: "quick-client",
      } as OAuthFlowState["oauthClientInfo"],
      oauthTokens: {
        access_token: "quick-token-abcdefghijklmnop",
        token_type: "Bearer",
      },
    });
    const { client } = makeClient(quickSuccess);
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        selectedAction="quick"
        inspectorClient={client}
        oauthStatus="success"
        oauthMessage={null}
      />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Quick Auth Results");
    expect(frame).toContain("quick-client");
    expect(frame).toContain("Access Token:");
    expect(frame).toContain("quick-token-abcdefgh");
  });

  it("renders the clear hint and the confirmation after pressing Enter", async () => {
    const onClearOAuth = vi.fn();
    const { client } = makeClient(flow({}));
    const { lastFrame, stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        selectedAction="clear"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        onClearOAuth={onClearOAuth}
      />,
    );
    expect(lastFrame() ?? "").toContain("Press [Enter] to clear OAuth state");
    // a leading no-op key absorbs any dropped first keypress
    stdin.write("x");
    await tick();
    stdin.write("\r");
    await tick();
    await tick();
    expect(onClearOAuth).toHaveBeenCalled();
    expect(lastFrame() ?? "").toContain("OAuth state cleared.");
  });

  it("shows the focused footer and header highlight when focused", () => {
    const { client } = makeClient(completeState);
    const { lastFrame } = render(
      <AuthTab
        {...baseProps}
        focused
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    expect(lastFrame() ?? "").toContain("select, G/Q/S or Enter run");
  });

  it("selects actions via G/Q/S keys when focused", async () => {
    const onSelectedActionChange = vi.fn();
    const { client } = makeClient(flow({}));
    const { stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        onSelectedActionChange={onSelectedActionChange}
      />,
    );
    stdin.write("g");
    await tick();
    stdin.write("q");
    await tick();
    stdin.write("s");
    await tick();
    expect(onSelectedActionChange).toHaveBeenCalledWith("guided");
    expect(onSelectedActionChange).toHaveBeenCalledWith("quick");
    expect(onSelectedActionChange).toHaveBeenCalledWith("clear");
  });

  it("cycles selection with left/right arrows from 'guided'", async () => {
    const onSelectedActionChange = vi.fn();
    const { client } = makeClient(flow({}));
    const { stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        onSelectedActionChange={onSelectedActionChange}
      />,
    );
    stdin.write(LEFT);
    await tick();
    stdin.write(RIGHT);
    await tick();
    expect(onSelectedActionChange).toHaveBeenCalledWith("clear");
    expect(onSelectedActionChange).toHaveBeenCalledWith("quick");
  });

  it("cycles selection with left/right arrows from 'quick'", async () => {
    const onSelectedActionChange = vi.fn();
    const { client } = makeClient(flow({ execution: "quick" }));
    const { stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        selectedAction="quick"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        onSelectedActionChange={onSelectedActionChange}
      />,
    );
    stdin.write(LEFT);
    await tick();
    stdin.write(RIGHT);
    await tick();
    expect(onSelectedActionChange).toHaveBeenCalledWith("guided");
    expect(onSelectedActionChange).toHaveBeenCalledWith("clear");
  });

  it("cycles selection with left/right arrows from 'clear'", async () => {
    const onSelectedActionChange = vi.fn();
    const { client } = makeClient(flow({}));
    const { stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        selectedAction="clear"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        onSelectedActionChange={onSelectedActionChange}
      />,
    );
    stdin.write(LEFT);
    await tick();
    stdin.write(RIGHT);
    await tick();
    expect(onSelectedActionChange).toHaveBeenCalledWith("quick");
    expect(onSelectedActionChange).toHaveBeenCalledWith("guided");
  });

  it("scrolls with up/down/pageUp/pageDown when focused", async () => {
    const { client } = makeClient(completeState);
    const { lastFrame, stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    stdin.write(UP);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();
    // still rendered (scroll stubs are no-ops)
    expect(lastFrame() ?? "").toContain("Guided OAuth Flow Progress");
  });

  it("runs guided to completion on Enter when 'guided' is selected", async () => {
    const onRunGuidedToCompletion = vi.fn(async () => {});
    const { client } = makeClient(flow({}));
    const { stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        onRunGuidedToCompletion={onRunGuidedToCompletion}
      />,
    );
    // a leading no-op key absorbs any dropped first keypress
    stdin.write("x");
    await tick();
    stdin.write("\r");
    await tick();
    expect(onRunGuidedToCompletion).toHaveBeenCalled();
  });

  it("runs quick auth on Enter when 'quick' is selected", async () => {
    const onQuickAuth = vi.fn(async () => {});
    const { client } = makeClient(flow({ execution: "quick" }));
    const { stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        selectedAction="quick"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        onQuickAuth={onQuickAuth}
      />,
    );
    stdin.write("x");
    await tick();
    stdin.write("\r");
    await tick();
    expect(onQuickAuth).toHaveBeenCalled();
  });

  it("advances guided one step on Space (start then advance)", async () => {
    const onGuidedStart = vi.fn(async () => {});
    const onGuidedAdvance = vi.fn(async () => {});
    // mid-flow state so needsAuthCode/isComplete are both false on advance
    const { client } = makeClient(
      flow({ execution: "guided", oauthStep: "client_registration" }),
    );
    const { stdin } = render(
      <AuthTab
        {...baseProps}
        focused
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
        onGuidedStart={onGuidedStart}
        onGuidedAdvance={onGuidedAdvance}
      />,
    );
    // first space starts the flow
    stdin.write(" ");
    await tick();
    // second space advances one step
    stdin.write(" ");
    await tick();
    // third space (in case the first was dropped) keeps both reachable
    stdin.write(" ");
    await tick();
    expect(onGuidedStart).toHaveBeenCalled();
    expect(onGuidedAdvance).toHaveBeenCalled();
  });

  it("does not act on input when not OAuth-capable but focused", async () => {
    const onSelectedActionChange = vi.fn();
    const { stdin, lastFrame } = render(
      <AuthTab
        {...baseProps}
        focused
        isOAuthCapable={false}
        selectedAction="guided"
        inspectorClient={null}
        oauthStatus="idle"
        oauthMessage={null}
        onSelectedActionChange={onSelectedActionChange}
      />,
    );
    stdin.write("g");
    await tick();
    expect(onSelectedActionChange).not.toHaveBeenCalled();
    expect(lastFrame() ?? "").toContain("Select an OAuth-capable server");
  });

  it("subscribes to oauth events and refreshes when they fire", async () => {
    const { client, fire, listeners } = makeClient(completeState);
    const { unmount } = render(
      <AuthTab
        {...baseProps}
        selectedAction="guided"
        inspectorClient={client}
        oauthStatus="idle"
        oauthMessage={null}
      />,
    );
    await tick();
    expect(listeners.get("oauthStepChange")?.size).toBe(1);
    expect(listeners.get("oauthComplete")?.size).toBe(1);
    // firing the listeners runs the update() callback
    fire("oauthStepChange");
    fire("oauthComplete");
    await tick();
    // unmount runs the cleanup (removeEventListener)
    unmount();
    expect(listeners.get("oauthStepChange")?.size).toBe(0);
    expect(listeners.get("oauthComplete")?.size).toBe(0);
  });
});
